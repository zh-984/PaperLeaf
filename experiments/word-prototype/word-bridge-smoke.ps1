$ErrorActionPreference = 'Stop'
if (Get-Process WINWORD -ErrorAction SilentlyContinue) { throw 'A Word process is already running; isolated test skipped.' }
$word = $null; $doc = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $doc = $word.Documents.Add()
  $doc.Content.Text = 'First paragraph. Second paragraph.'
  $settings = @{ markerTemplate='[{{number}}]'; referenceTemplate='[{{number}}] {{authors}}. {{title}}. {{year}}.' }
  function Run-Bridge([string]$action, [string]$id, [string]$title) {
    $request = @{action=$action; settings=$settings; reference=@{paperId=$id; title=$title; type='journal'; authors='Tester'; year='2025'; journal=''; volume=''; issue=''; pages=''; doi=''; publisher=''}} | ConvertTo-Json -Depth 8 -Compress
    $output = $request | & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'word-bridge.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Word bridge failed' }
    return ($output | ConvertFrom-Json)
  }
  $word.Selection.SetRange(6, 6)
  $first = Run-Bridge 'insert' 'paperB' 'Paper B'
  $word.Selection.SetRange(0, 0)
  $second = Run-Bridge 'insert' 'paperA' 'Paper A'
  $refs = @($doc.ContentControls | Where-Object { $_.Tag -like 'paperleaf-ref:*' } | Sort-Object { $_.Range.Start })
  if ($refs.Count -ne 2 -or $refs[0].Range.Text -ne '[1]' -or $refs[1].Range.Text -ne '[2]') { throw 'Citation order incorrect' }
  $bib = @($doc.ContentControls | Where-Object { $_.Tag -eq 'paperleaf-bibliography' })
  if ($bib.Count -ne 1 -or $bib[0].Range.Text -notmatch 'Paper A' -or $bib[0].Range.Text -notmatch 'Paper B') { throw 'Bibliography incorrect' }
  $word.Selection.SetRange(0, 0)
  $repeat = Run-Bridge 'insert' 'paperB' 'Paper B'
  $refs = @($doc.ContentControls | Where-Object { $_.Tag -like 'paperleaf-ref:*' } | Sort-Object { $_.Range.Start })
  if ($refs.Count -ne 3 -or $refs[0].Range.Text -ne '[1]' -or $refs[1].Range.Text -ne '[2]' -or $refs[2].Range.Text -ne '[1]') { throw 'Duplicate numbering incorrect' }
  if ($repeat.references -ne 2) { throw 'Duplicate bibliography entry' }
  $dir = Join-Path $PSScriptRoot '../../.test-data/word-smoke'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $file = (Join-Path (Resolve-Path $dir) 'citations.docx')
  $doc.SaveAs2($file, 16)
  $doc.Close(0); $doc = $null
  $doc = $word.Documents.Open($file)
  if (@($doc.ContentControls | Where-Object { $_.Tag -like 'paperleaf-ref:*' }).Count -ne 3) { throw 'Citations did not survive reopen' }
  $last = Run-Bridge 'update' 'paperA' 'Paper A'
  if ($last.references -ne 2) { throw 'Reopened bibliography update failed' }
  Write-Output 'PASS: isolated Word insert, source-order numbering, duplicate citations, bibliography and reopen.'
} finally {
  if ($doc) { $doc.Close(0) }
  if ($word) { $noSave = 0; $word.Quit([ref]$noSave) }
}
