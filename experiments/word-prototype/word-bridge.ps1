param([switch]$TestMode)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
try {
  $stage = 'connect'
  $word = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
  if ($word.Documents.Count -lt 1) { throw 'Open a Word document first.' }
  $doc = $word.ActiveDocument
  if ($doc.ReadOnly -or $doc.ProtectionType -ne -1 -or $doc.TrackRevisions) { throw 'Read-only, protected, or tracked-change documents are not supported.' }
  $ns = 'urn:paperleaf:citations:v1'
  $parts = $doc.CustomXMLParts.SelectByNamespace($ns)
  if ($parts.Count -gt 1) { throw 'Document has multiple Paperleaf metadata records; no changes were made.' }
  if ($parts.Count -eq 1) {
    $xml = [xml]$parts.Item(1).XML
    $node = $xml.SelectSingleNode('//*[local-name()="data"]')
    if (!$node) { throw 'Document citation metadata is invalid.' }
    $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($node.InnerText))
    $state = $json | ConvertFrom-Json
  } else {
    $state = [pscustomobject]@{ version = 1; references = @(); settings = $request.settings }
  }
  if ($state.version -ne 1) { throw 'Unsupported citation metadata version.' }
  $settings = $request.settings
  if (!$settings.markerTemplate -or !$settings.referenceTemplate) { throw 'Citation format is missing.' }
  if ($request.action -eq 'insert') {
    $stage = 'insert citation'
    if ($word.Selection.StoryType -ne 1) { throw 'Place the cursor in the main document body.' }
    $selection = $word.Selection.Range.Duplicate
    $selection.Collapse(0)
    if ($selection.ContentControls.Count -gt 0) { throw 'Place the cursor outside existing content controls.' }
    $state.references = @($state.references | Where-Object { $_.paperId -ne $request.reference.paperId }) + @($request.reference)
  } elseif ($request.action -ne 'update') { throw 'Unsupported Word operation.' }
  $state.settings = $settings
  $controls = @($doc.ContentControls | Where-Object { $_.Tag -like 'paperleaf-ref:*' })
  foreach ($control in $controls) { if ($control.Range.StoryType -ne 1) { throw 'Citations outside the main document body are not supported.' } }
  $bibliographies = @($doc.ContentControls | Where-Object { $_.Tag -eq 'paperleaf-bibliography' })
  if ($bibliographies.Count -gt 1) { throw 'Multiple Paperleaf bibliographies found; no changes were made.' }
  $byId = @{}
  foreach ($reference in @($state.references)) { $byId[$reference.paperId] = $reference }
  foreach ($control in $controls) {
    $id = $control.Tag.Substring('paperleaf-ref:'.Length)
    if (!$byId.ContainsKey($id)) { throw 'A citation is missing its bibliographic snapshot; no changes were made.' }
  }
  function Format-Template([string]$template, $reference, [int]$number) {
    $labels = @{ journal='J'; book='M'; thesis='D'; conference='C'; web='EB/OL'; other='Z' }
    $values = @{ number=[string]$number; type=$labels[[string]$reference.type] }
    foreach ($name in @('title','authors','year','journal','volume','issue','pages','doi','publisher')) { $values[$name] = [string]$reference.$name }
    $result = [regex]::Replace($template, '\{\{([a-z]+)\}\}', { param($m) if ($values.ContainsKey($m.Groups[1].Value)) { [string]$values[$m.Groups[1].Value] } else { '' } })
    $result = $result -replace '\(\s*\)', '' -replace '\[\s*\]', '' -replace '\s+([,.:;])', '$1' -replace '([,.:;])\s*([,.:;])+', '$1' -replace '\s{2,}', ' '
    return $result.Trim().Trim([char[]]',.:; ')
  }
  if ($request.action -eq 'insert') {
    $newControl = $doc.ContentControls.Add(1, $selection)
    $newControl.Tag = 'paperleaf-ref:' + $request.reference.paperId
    $newControl.Title = 'Paperleaf citation'
    $newControl.Range.Text = '[?]'
    $controls = @($controls) + @($newControl)
  }
  $controls = @($controls | Sort-Object { $_.Range.Start })
  $numbers = @{}; $ordered = @()
  foreach ($control in $controls) {
    $id = $control.Tag.Substring('paperleaf-ref:'.Length)
    if (!$numbers.ContainsKey($id)) { $numbers[$id] = $numbers.Count + 1; $ordered += $id }
  }
  foreach ($control in @($controls | Sort-Object { $_.Range.Start } -Descending)) {
    $stage = 'update citation'
    $id = $control.Tag.Substring('paperleaf-ref:'.Length)
    $control.Range.Text = Format-Template $settings.markerTemplate $byId[$id] $numbers[$id]
  }
  $lines = @('References')
  foreach ($id in $ordered) { $lines += (Format-Template $settings.referenceTemplate $byId[$id] $numbers[$id]) }
  if ($bibliographies.Count -eq 0) {
    $stage = 'create bibliography'
    $end = $doc.Content.End - 1
    $range = $doc.Range($end, $end)
    $stage = 'insert bibliography paragraph'
    $range.InsertBefore("`r")
    $end = $doc.Content.End - 1
    $range = $doc.Range($end, $end)
    $stage = 'add bibliography control at ' + $range.Start + ' of ' + $doc.Content.End
    $bibliography = $doc.ContentControls.Add(0, $range)
    $bibliography.Tag = 'paperleaf-bibliography'
    $bibliography.Title = 'Paperleaf bibliography'
  } else { $bibliography = $bibliographies[0] }
  $stage = 'update bibliography'
  $bibliography.Range.Text = $lines -join "`r"
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($state | ConvertTo-Json -Depth 12 -Compress)))
  $newPart = $doc.CustomXMLParts.Add('<state xmlns="urn:paperleaf:citations:v1"><data>' + $encoded + '</data></state>')
  if ($parts.Count -eq 1) { $parts.Item(1).Delete() }
  [Console]::Out.WriteLine((@{ ok=$true; citations=$controls.Count; references=$ordered.Count } | ConvertTo-Json -Compress))
} catch {
  [Console]::Error.WriteLine($stage + ': ' + $_.Exception.Message)
  exit 1
}
