# Opens a file in real Microsoft Office (read-only, hidden, no prompts) and prints what it found as JSON.
# Used by e2e/office.spec.ts. If that Office app is already running, the check is skipped: automation could attach to
# the user's own window and closing it would close their work.
# Visio only: -SaveCopy also has Visio save the drawing as a new .vsdx there (Visio's own writing of it, to open back in RackDraw).
param([Parameter(Mandatory)][ValidateSet('word', 'excel', 'powerpoint', 'visio')][string]$App, [Parameter(Mandatory)][string]$Path, [string]$SaveCopy)
$ErrorActionPreference = 'Stop'
$proc = @{ word = 'WINWORD'; excel = 'EXCEL'; powerpoint = 'POWERPNT'; visio = 'VISIO' }[$App]
if (Get-Process -Name $proc -ErrorAction SilentlyContinue) { @{ skipped = "$proc is already running" } | ConvertTo-Json -Compress; exit 0 }
$o = $null
try {
  switch ($App) {
    'word' {
      $o = New-Object -ComObject Word.Application
      $o.Visible = $false; $o.DisplayAlerts = 0
      $d = $o.Documents.Open($Path, $false, $true, $false)
      $r = @{ ok = $true; paragraphs = $d.Paragraphs.Count; tables = $d.Tables.Count; pictures = $d.InlineShapes.Count + $d.Shapes.Count }
      $d.Close(0)
    }
    'excel' {
      $o = New-Object -ComObject Excel.Application
      $o.Visible = $false; $o.DisplayAlerts = $false
      $w = $o.Workbooks.Open($Path, 0, $true)
      $s = $w.Worksheets.Item(1)
      $r = @{ ok = $true; sheets = $w.Worksheets.Count; rows = $s.UsedRange.Rows.Count; columns = $s.UsedRange.Columns.Count }
      $w.Close($false)
    }
    'powerpoint' {
      $o = New-Object -ComObject PowerPoint.Application
      # ReadOnly, Untitled, WithWindow = false
      $p = $o.Presentations.Open($Path, -1, 0, 0)
      $r = @{ ok = $true; slides = $p.Slides.Count }
      $p.Close()
    }
    'visio' {
      $o = New-Object -ComObject Visio.InvisibleApp
      $o.AlertResponse = 7 # "No" to any question
      $d = $o.Documents.OpenEx($Path, 2 + 128) # read-only, no workspace
      $shapes = 0; foreach ($pg in $d.Pages) { $shapes += $pg.Shapes.Count }
      $r = @{ ok = $true; pages = $d.Pages.Count; shapes = $shapes }
      if ($SaveCopy) { $d.SaveAs($SaveCopy); $r.saved = $SaveCopy }
      $d.Close()
    }
  }
  $r | ConvertTo-Json -Compress
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
} finally {
  if ($o) { try { $o.Quit() } catch {} ; [void][Runtime.InteropServices.Marshal]::ReleaseComObject($o) }
}
