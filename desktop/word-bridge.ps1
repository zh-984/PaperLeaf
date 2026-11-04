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
function Get-ScientificFormatting([string]$text) {
  $sub = @(0x2080,0x2081,0x2082,0x2083,0x2084,0x2085,0x2086,0x2087,0x2088,0x2089,0x208a,0x208b,0x208c,0x208d,0x208e,0x2090,0x2091,0x2095,0x1d62,0x2c7c,0x2096,0x2097,0x2098,0x2099,0x2092,0x209a,0x1d63,0x209b,0x209c,0x1d64,0x1d65,0x2093)
  $sup = @(0x2070,0x00b9,0x00b2,0x00b3,0x2074,0x2075,0x2076,0x2077,0x2078,0x2079,0x207a,0x207b,0x207c,0x207d,0x207e,0x207f,0x2071,0x02e3)
  $map = @{}
  $letters = '0123456789+-=()aehijklmnoprstuvx'
  for ($i=0; $i -lt $sub.Count; $i++) { $map[[char]$sub[$i]] = @{text=$letters[$i]; script='sub'} }
  $letters = '0123456789+-=()nix'
  for ($i=0; $i -lt $sup.Count; $i++) { $map[[char]$sup[$i]] = @{text=$letters[$i]; script='sup'} }
  $plain = ''; $runs = @(); $position = 0
  for ($cursor=0; $cursor -lt $text.Length; $cursor++) {
    $character = $text[$cursor]
    if (($character -eq '_' -or $character -eq '^') -and $cursor+1 -lt $text.Length -and $text[$cursor+1] -eq '{') {
      $closing = $text.IndexOf('}', $cursor+2)
      if ($closing -gt $cursor+2) {
        $script = if ($character -eq '_') { 'sub' } else { 'sup' }
        foreach ($letter in $text.Substring($cursor+2,$closing-$cursor-2).ToCharArray()) {
          $plain += $letter; $runs += @{position=$position; script=$script}; $position++
        }
        $cursor=$closing; continue
      }
    }
    if ($map.ContainsKey($character)) { $item=$map[$character]; $plain += $item.text; $runs += @{position=$position; script=$item.script} }
    else { $plain += $character }
    $position++
  }
  return @{text=$plain; runs=$runs}
}
function Format-Scientific([string]$text) {
  $text = [regex]::Replace($text, '\$([^$]*[_^][^$]*)\$', '$1')
  $sub = @(0x2080,0x2081,0x2082,0x2083,0x2084,0x2085,0x2086,0x2087,0x2088,0x2089,0x208a,0x208b,0x208c,0x208d,0x208e,0x2090,0x2091,0x2095,0x1d62,0x2c7c,0x2096,0x2097,0x2098,0x2099,0x2092,0x209a,0x1d63,0x209b,0x209c,0x1d64,0x1d65,0x2093)
  $sup = @(0x2070,0x00b9,0x00b2,0x00b3,0x2074,0x2075,0x2076,0x2077,0x2078,0x2079,0x207a,0x207b,0x207c,0x207d,0x207e,0x207f,0x2071,0x02e3)
  return [regex]::Replace($text, '([_^])(?:\{([^{}]+)\}|([A-Za-z0-9+\-=()]))', {
    param($match)
    $letters = if ($match.Groups[1].Value -eq '_') { '0123456789+-=()aehijklmnoprstuvx' } else { '0123456789+-=()nix' }
    $codes = if ($match.Groups[1].Value -eq '_') { $sub } else { $sup }
    $value = if ($match.Groups[2].Success) { $match.Groups[2].Value } else { $match.Groups[3].Value }
    $result = ''
    foreach ($character in $value.ToCharArray()) { $index = $letters.IndexOf($character); if ($index -lt 0) { return $match.Value }; $result += [char]$codes[$index] }
    return $result
  })
}
function Format-Template([string]$template, $reference, [int]$number) {
  $labels = @{ journal='J'; book='M'; thesis='D'; conference='C'; web='EB/OL'; other='Z' }
  $values = @{ number=[string]$number; type=$labels[[string]$reference.type] }
  foreach ($name in @('title','authors','year','journal','volume','issue','pages','doi','publisher')) { $values[$name] = [string]$reference.$name }
  $values.authors = $values.authors -replace '\s*[;\uFF1B]\s*', ', '
  $result = [regex]::Replace($template, '\{\{([a-z]+)\}\}', { param($m) if ($values.ContainsKey($m.Groups[1].Value)) { [string]$values[$m.Groups[1].Value] } else { '' } })
  $result = $result -replace '\(\s*\)', '' -replace '\[\s*\]', '' -replace '\s+([,.:;])', '$1' -replace '([,.:;])\s*([,.:;])+', '$1' -replace '\s{2,}', ' '
  return Format-Scientific (($result -replace '^[,.:;\s]+|[,;:\s]+$', '').Trim())
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
  $lines = @()
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
    $scientific = Get-ScientificFormatting ($lines -join "`r")
    $range.Text = $scientific.text
    $range = Entry-Range $bibliography
    $range.Style = -1 # Word's built-in Normal style, independent of display language.
    $range.ListFormat.RemoveNumbers()
    $range.ParagraphFormat.OutlineLevel = 10
    $range.Font.Bold = 0
    $range.Font.Italic = 0
    $range.Font.Underline = 0
    $range.Font.Superscript = 0
    $range.Font.Subscript = 0
    $range.Font.Name = 'Times New Roman'
    $range.Font.NameAscii = 'Times New Roman'
    $range.Font.NameOther = 'Times New Roman'
    $range.Font.NameFarEast = -join ([char[]]@(0x5b8b,0x4f53))
    $stage = 'format bibliography indentation'
    # Reset previous settings before applying character-unit (not approximate point) indents.
    $range.ParagraphFormat.LeftIndent = 0
    $range.ParagraphFormat.FirstLineIndent = 0
    $range.ParagraphFormat.CharacterUnitLeftIndent = 0
    $range.ParagraphFormat.CharacterUnitFirstLineIndent = 0
    $range.ParagraphFormat.LineSpacingRule = 0
    $range.ParagraphFormat.SpaceBefore = 0
    $range.ParagraphFormat.SpaceAfter = 0
    for ($index=1; $index -le $range.Paragraphs.Count; $index++) {
      $stage = 'indent paragraph ' + $index
      $format = $range.Paragraphs.Item($index).Format
      if ($settings.bibliographyIndent -eq 'firstLine') { $format.CharacterUnitFirstLineIndent = $indent }
      elseif ($settings.bibliographyIndent -eq 'hanging') {
        $format.CharacterUnitLeftIndent = $indent
        $leftPoints = [single]$format.LeftIndent
        # Word combines character-unit and point-based indents; clear character units first.
        $format.CharacterUnitLeftIndent = 0
        $format.CharacterUnitFirstLineIndent = 0
        $format.LeftIndent = $leftPoints
        $format.FirstLineIndent = -$leftPoints
      }
    }
    foreach ($run in $scientific.runs) {
      $characterRange = $range.Characters.Item($run.position + 1)
      if ($run.script -eq 'sub') { $characterRange.Font.Subscript = -1 } else { $characterRange.Font.Superscript = -1 }
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
