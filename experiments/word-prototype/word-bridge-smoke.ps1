# Uses only newly-created test documents and its own Word instance, even with user documents open.
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$word=$null; $doc=$null; $owned=$false
try {
  $previousHwnd = 0
  try { $previousHwnd = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application').Hwnd } catch { }
  $word = New-Object -ComObject Word.Application
  if ($previousHwnd -and $word.Hwnd -eq $previousHwnd) { throw 'Isolated Word instance unavailable; user documents were not changed.' }
  $owned=$true
  $word.Visible=$false; $word.DisplayAlerts=0
  $dir = Join-Path $PSScriptRoot '../../.test-data/word-smoke'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  foreach ($mode in @('docx','doc','legacy')) {
    $doc=$word.Documents.Add()
    $doc.Content.Text = 'First paragraph. Second paragraph.'
    $extension = if ($mode -eq 'doc') { 'doc' } else { 'docx' }
    $file=Join-Path (Resolve-Path $dir) ('citations-'+[guid]::NewGuid().ToString('N')+'.'+$extension)
    [object]$saveTarget=[string]$file; [object]$saveFormat=if ($mode -eq 'doc') { 0 } else { 16 }
    $doc.SaveAs([ref]$saveTarget,[ref]$saveFormat)
    $settings=@{markerTemplate='[{{number}}]'; referenceTemplate='[{{number}}] {{authors}}. {{title}}. {{year}}.'; markerSuperscript=$true; bibliographyIndent='hanging'; indentCharacters=2}
    function Run-Bridge([string]$action,[string]$id,[string]$title) {
      if ($id -eq 'paperB') { $title += ' ' + (-join ([char[]]@(0x6d4b,0x8bd5))) }
      $request=@{action=$action; testDocument=$file; settings=$settings; reference=@{paperId=$id; title=$title; type='journal'; authors='Tester'; year='2026'; journal=''; volume=''; issue=''; pages=''; doi=''; publisher=''}} | ConvertTo-Json -Depth 8 -Compress
      $output=$request | & node (Join-Path $PSScriptRoot '../../tests/word-invoke.mjs') --isolated
      if ($LASTEXITCODE -ne 0) { throw 'Word bridge failed' }
      return ($output | ConvertFrom-Json)
    }
    function Get-Citations {
      $results=@($doc.Fields | Where-Object {$_.Code.Text -match '^\s*ADDIN PAPERLEAF_CITATION '} | ForEach-Object { $_.Result })
      if ($mode -eq 'legacy') { $results += @($doc.ContentControls | Where-Object {$_.Tag -like 'paperleaf-ref:*'} | ForEach-Object {$_.Range}) }
      return @($results | Sort-Object Start)
    }
    function Get-Bibliography { return @($doc.Fields | Where-Object {$_.Code.Text -match '^\s*ADDIN PAPERLEAF_BIBLIOGRAPHY'})[0].Result }
    if ($mode -eq 'legacy') {
      $r=$doc.Range(6,6); $r.Select(); $cc=$doc.ContentControls.Add(1,$r); $cc.Tag='paperleaf-ref:paperB'; $cc.Range.Text='[1]'
      $state=@{version=1; references=@(@{paperId='paperB'; title='Paper B'; type='journal'; authors='Tester'; year='2026'}); settings=$settings} | ConvertTo-Json -Depth 8 -Compress
      $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($state))
      $null=$doc.CustomXMLParts.Add('<state xmlns="urn:paperleaf:citations:v1"><data>'+$encoded+'</data></state>')
      $first=Run-Bridge 'update' 'paperB' 'Paper B'
    } else {
      $word.Selection.SetRange(6,6)
      $first=Run-Bridge 'insert' 'paperB' 'Paper B'
    }
    $word.Selection.SetRange(0,0)
    $second=Run-Bridge 'insert' 'paperA' 'Paper A'
    $refs=@(Get-Citations)
    if ($refs.Count -ne 2 -or $refs[0].Text -ne '[1]' -or $refs[1].Text -ne '[2]') {throw "Numbering failed: $mode"}
    foreach ($r in $refs) {if ($r.Font.Superscript -ne -1) {throw "Superscript missing: $mode"}}
    if ($word.Selection.Font.Superscript -ne 0) {throw 'Following text inherits superscript'}
    $bib=Get-Bibliography
    if (!$bib.Text.Contains((-join ([char[]]@(0x6d4b,0x8bd5))))) {throw 'Unicode metadata corrupted'}
    if ($bib.Font.Superscript -ne 0) {throw 'Bibliography incorrectly superscripted'}
    if ([math]::Abs($bib.Paragraphs.Item(2).Format.CharacterUnitFirstLineIndent + 2) -gt 0.05) {throw 'Hanging indent missing'}
    if ([math]::Abs($bib.Paragraphs.Item(2).Format.CharacterUnitLeftIndent - 2) -gt 0.05) {throw 'Hanging left indent missing'}
    if ($bib.Paragraphs.Item(1).Format.CharacterUnitFirstLineIndent -ne 0) {throw 'Heading indented'}
    $word.Selection.SetRange(0,0)
    $repeat=Run-Bridge 'insert' 'paperB' 'Paper B'
    $refs=@(Get-Citations)
    if ($refs.Count -ne 3 -or $refs[0].Text -ne '[1]' -or $refs[1].Text -ne '[2]' -or $refs[2].Text -ne '[1]' -or $repeat.references -ne 2) {throw 'Duplicate numbering failed'}
    $doc.Save(); $doc.Close(0); $doc=$null
    $doc=$word.Documents.Open($file)
    $last=Run-Bridge 'update' 'paperA' 'Paper A edited'
    if ($last.references -ne 2 -or (Get-Bibliography).Text -notmatch 'Paper A edited') {throw 'Reopen/metadata update failed'}
    $field=@($doc.Fields | Where-Object {$_.Code.Text -match '^\s*ADDIN PAPERLEAF_CITATION '} | Sort-Object {$_.Result.Start})[1]
    # The middle citation is A in all fixture modes.
    $full=$doc.Range($field.Code.Start-1,$field.Result.End+1); $null=$full.Delete()
    $settings.markerTemplate='({{number}})'; $settings.markerSuperscript=$false; $settings.bibliographyIndent='firstLine'; $settings.indentCharacters=1.5
    $last=Run-Bridge 'update' 'paperB' 'Paper B'
    if ($last.references -ne 1) {throw 'Deleted reference remained'}
    foreach ($r in @(Get-Citations)) {if ($r.Text -ne '(1)' -or $r.Font.Superscript -ne 0) {throw 'Marker format update failed'}}
    $bib=Get-Bibliography
    if ([math]::Abs($bib.Paragraphs.Item(2).Format.CharacterUnitFirstLineIndent - 1.5) -gt 0.05 -or $bib.Paragraphs.Item(2).Format.CharacterUnitLeftIndent -ne 0) {throw 'First-line indent update failed'}
    $settings.bibliographyIndent='none'
    $null=Run-Bridge 'update' 'paperB' 'Paper B'
    $bib=Get-Bibliography
    if ($bib.Paragraphs.Item(2).Format.CharacterUnitFirstLineIndent -ne 0 -or $bib.Paragraphs.Item(2).Format.CharacterUnitLeftIndent -ne 0) {throw 'Clear indent failed'}
    $doc.Save(); $doc.Close(0); $doc=$null
    Write-Output "PASS $mode : insert, reorder, duplicates, superscript, indents, reopen, metadata update, deletion, old control compatibility."
  }
} finally {
  if ($owned) {
    if ($doc) {$doc.Close(0)}
    $noSave=0; $word.Quit([ref]$noSave)
  }
}
