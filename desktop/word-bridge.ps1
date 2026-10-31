param([switch]$TestMode)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$recording = $false
$stage = 'connect'
function Encode-Data($value) { return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($value | ConvertTo-Json -Depth 12 -Compress))) }
function Decode-Data([string]$value) { return ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($value)) | ConvertFrom-Json) }
function Entry-Range($entry) { if ($entry.kind -eq 'field') { return $entry.item.Result } else { return $entry.item.Range } }
function Format-Template([string]$template, $reference, [int]$number) {
  $labels = @{ journal='J'; book='M'; thesis='D'; conference='C'; web='EB/OL'; other='Z' }
  $values = @{ number=[string]$number; type=$labels[[string]$reference.type] }
  foreach ($name in @('title','authors','year','journal','volume','issue','pages','doi','publisher')) { $values[$name] = [string]$reference.$name }
  $result = [regex]::Replace($template, '\{\{([a-z]+)\}\}', { param($m) if ($values.ContainsKey($m.Groups[1].Value)) { [string]$values[$m.Groups[1].Value] } else { '' } })
  $result = $result -replace '\(\s*\)', '' -replace '\[\s*\]', '' -replace '\s+([,.:;])', '$1' -replace '([,.:;])\s*([,.:;])+', '$1' -replace '\s{2,}', ' '
  return ($result -replace '^[,.:;\s]+|[,;:\s]+$', '').Trim()
}
function New-ManagedField($range, [string]$code) {
  # Zotero also creates a QUOTE field before replacing its code, avoiding ADDIN range issues.
  $field = $doc.Fields.Add($range, 35, '"[?]"', $false)
  $field.Code.Text = ' ADDIN ' + $code + ' '
  return $field
}
try {
  if ($TestMode) {
    $testPath = [IO.Path]::GetFullPath([string]$request.testDocument)
    $testRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.test-data/word-smoke')) + [IO.Path]::DirectorySeparatorChar
    if (!$testPath.StartsWith($testRoot, [StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $testPath)) { throw 'Invalid isolated test document.' }
    $doc = [Runtime.InteropServices.Marshal]::BindToMoniker($testPath)
    $word = $doc.Application
    $doc.Activate()
  } else {
    $word = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
    if ($word.Documents.Count -lt 1) { throw 'Open a Word document first.' }
    $doc = $word.ActiveDocument
  }
  if ($doc.ReadOnly -or $doc.ProtectionType -ne -1 -or $doc.TrackRevisions) { throw 'Read-only, protected, or tracked-change documents are not supported.' }
  $settings = $request.settings
  if (!$settings.markerTemplate -or !$settings.referenceTemplate) { throw 'Citation format is missing.' }
  $superscript = $settings.markerSuperscript -ne $false
  $indent = [double]$settings.indentCharacters
  if ($indent -lt 0 -or $indent -gt 10 -or [double]::IsNaN($indent)) { throw 'Invalid indent size.' }
  $controls = @(); $bibliographies = @(); $entries = @(); $byId = @{}
  $oldPart = $null
  $stage = 'read citations'
  # Legacy .doc files do not implement content controls. New citations use fields in both formats.
  if ($doc.CompatibilityMode -ge 12) {
    $controls = @($doc.ContentControls | Where-Object { $_.Tag -like 'paperleaf-ref:*' })
    $bibliographies = @($doc.ContentControls | Where-Object { $_.Tag -eq 'paperleaf-bibliography' } | ForEach-Object { [pscustomobject]@{kind='control'; item=$_} })
    if ($controls.Count -gt 0) {
      $parts = $doc.CustomXMLParts.SelectByNamespace('urn:paperleaf:citations:v1')
      if ($parts.Count -ne 1) { throw 'Legacy Paperleaf citation metadata is missing or duplicated.' }
      $oldPart = $parts.Item(1)
      $xml = [xml]$oldPart.XML
      $state = Decode-Data $xml.SelectSingleNode('//*[local-name()="data"]').InnerText
      foreach ($reference in @($state.references)) { $byId[$reference.paperId] = $reference }
      foreach ($control in $controls) {
        if ($control.Range.StoryType -ne 1) { throw 'Citations outside the main document body are not supported.' }
        $entries += [pscustomobject]@{kind='control'; item=$control; id=$control.Tag.Substring(14)}
      }
    }
  }
  foreach ($field in @($doc.Fields)) {
    $code = $field.Code.Text.Trim()
    if ($code -match '^ADDIN PAPERLEAF_CITATION ([A-Za-z0-9+/=]+)$') {
      $snapshot = Decode-Data $Matches[1]
      if ($snapshot.version -ne 1 -or !$snapshot.reference.paperId -or !$snapshot.reference.title) { throw 'Invalid Paperleaf citation field.' }
      $id = $snapshot.reference.paperId
      $byId[$id] = $snapshot.reference
      $entries += [pscustomobject]@{kind='field'; item=$field; id=$id}
    } elseif ($code -match '^ADDIN PAPERLEAF_BIBLIOGRAPHY(?: |$)') {
      $bibliographies += [pscustomobject]@{kind='field'; item=$field}
    }
  }
  if ($bibliographies.Count -gt 1) { throw 'Multiple Paperleaf bibliographies found; no changes were made.' }
  foreach ($entry in $entries) { if (!$byId.ContainsKey($entry.id)) { throw 'A citation is missing its bibliographic snapshot.' } }
  if ($request.reference -and $request.reference.paperId) { $byId[$request.reference.paperId] = $request.reference }
  if ($request.action -eq 'insert') {
    $stage = 'check insertion point'
    if ($word.Selection.StoryType -ne 1) { throw 'Place the cursor in the main document body.' }
    $selection = $word.Selection.Range.Duplicate
    $selection.Collapse(0)
    if ($doc.CompatibilityMode -ge 12 -and $selection.ContentControls.Count -gt 0) { throw 'Place the cursor outside existing content controls.' }
    foreach ($field in @($doc.Fields)) {
      if ($selection.Start -gt ($field.Code.Start - 1) -and $selection.Start -le $field.Result.End) { throw 'Place the cursor outside an existing field.' }
    }
  } elseif ($request.action -ne 'update') { throw 'Unsupported Word operation.' }
  $stage = 'begin undo record'
  # Grouping undo is optional, never a reason to reject an otherwise supported document.
  try { $word.UndoRecord.StartCustomRecord('Paperleaf citations'); $recording = $true } catch { $recording = $false }
  if ($request.action -eq 'insert') {
    $stage = 'insert citation field'
    $newField = New-ManagedField $selection ('PAPERLEAF_CITATION ' + (Encode-Data @{version=1; reference=$request.reference}))
    $entries += [pscustomobject]@{kind='field'; item=$newField; id=$request.reference.paperId}
  }
  $entries = @($entries | Sort-Object { (Entry-Range $_).Start })
  $numbers = @{}; $ordered = @()
  foreach ($entry in $entries) {
    if (!$numbers.ContainsKey($entry.id)) { $numbers[$entry.id] = $numbers.Count + 1; $ordered += $entry.id }
  }
  foreach ($entry in @($entries | Sort-Object { (Entry-Range $_).Start } -Descending)) {
    $stage = 'update citation field'
    $reference = $byId[$entry.id]
    if ($entry.kind -eq 'field') { $entry.item.Code.Text = ' ADDIN PAPERLEAF_CITATION ' + (Encode-Data @{version=1; reference=$reference}) + ' ' }
    $range = Entry-Range $entry
    $range.Text = Format-Template $settings.markerTemplate $reference $numbers[$entry.id]
    $range = Entry-Range $entry
    $range.Font.Superscript = [int](-[int]$superscript)
  }
  # Unicode heading without relying on the PowerShell 5.1 source-file encoding.
  $lines = @((-join ([char[]]@(0x53c2,0x8003,0x6587,0x732e))))
  foreach ($id in $ordered) { $lines += (Format-Template $settings.referenceTemplate $byId[$id] $numbers[$id]) }
  if ($bibliographies.Count -eq 0 -and $entries.Count -gt 0) {
    $stage = 'create bibliography field'
    $end = $doc.Content.End - 1
    $range = $doc.Range($end, $end)
    $range.InsertBefore("`r")
    $end = $doc.Content.End - 1
    $range = $doc.Range($end, $end)
    $range.Select()
    $bibliography = [pscustomobject]@{kind='field'; item=(New-ManagedField $range 'PAPERLEAF_BIBLIOGRAPHY')}
  } elseif ($bibliographies.Count -gt 0) { $bibliography = $bibliographies[0] } else { $bibliography = $null }
  if ($null -ne $bibliography) {
    $stage = 'update bibliography text'
    if ($bibliography.kind -eq 'field') { $bibliography.item.Code.Text = ' ADDIN PAPERLEAF_BIBLIOGRAPHY ' + (Encode-Data @{version=1; settings=$settings}) + ' ' }
    $range = Entry-Range $bibliography
    $range.Text = $lines -join "`r"
    $range = Entry-Range $bibliography
    $range.Font.Superscript = 0
    $stage = 'format bibliography indentation'
    # Reset previous settings before applying character-unit (not approximate point) indents.
    $range.ParagraphFormat.LeftIndent = 0
    $range.ParagraphFormat.FirstLineIndent = 0
    $range.ParagraphFormat.CharacterUnitLeftIndent = 0
    $range.ParagraphFormat.CharacterUnitFirstLineIndent = 0
    for ($index=2; $index -le $range.Paragraphs.Count; $index++) {
      $format = $range.Paragraphs.Item($index).Format
      if ($settings.bibliographyIndent -eq 'firstLine') { $format.CharacterUnitFirstLineIndent = $indent }
      elseif ($settings.bibliographyIndent -eq 'hanging') { $format.CharacterUnitLeftIndent = $indent; $format.CharacterUnitFirstLineIndent = -$indent }
    }
  }
  if ($null -ne $oldPart) {
    $stage = 'save legacy citation metadata'
    $encoded = Encode-Data @{version=1; references=@($byId.Values); settings=$settings}
    $null = $doc.CustomXMLParts.Add('<state xmlns="urn:paperleaf:citations:v1"><data>' + $encoded + '</data></state>')
    $oldPart.Delete()
  }
  if ($recording) { $word.UndoRecord.EndCustomRecord(); $recording = $false }
  if ($request.action -eq 'insert') {
    $position = $newField.Result.End + 1
    $word.Selection.SetRange($position, $position)
    $word.Selection.Font.Superscript = 0
  }
  [Console]::Out.WriteLine((@{ok=$true; citations=$entries.Count; references=$ordered.Count} | ConvertTo-Json -Compress))
} catch {
  if ($recording) { try { $word.UndoRecord.EndCustomRecord(); $null = $doc.Undo(1) } catch { } }
  [Console]::Error.WriteLine($stage + ': ' + $_.Exception.Message)
  exit 1
}
