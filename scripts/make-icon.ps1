param(
  [string]$Source = "desktop/assets/app-icon.png",
  [string]$Out = "desktop/assets/app-icon.ico"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$sourcePath = (Resolve-Path $Source).Path
$outPath = Join-Path (Get-Location) $Out
$src = [System.Drawing.Image]::FromFile($sourcePath)
$pngs = @()

try {
  foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($src, 0, 0, $size, $size)
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngs += ,@{ Size = $size; Bytes = $ms.ToArray() }
    $graphics.Dispose()
    $bmp.Dispose()
    $ms.Dispose()
  }
} finally {
  $src.Dispose()
}

$fs = [System.IO.File]::Create($outPath)
$bw = New-Object System.IO.BinaryWriter($fs)
try {
  $bw.Write([UInt16]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]$pngs.Count)
  $offset = 6 + (16 * $pngs.Count)
  foreach ($png in $pngs) {
    $size = [int]$png.Size
    $headerSize = if ($size -eq 256) { 0 } else { $size }
    $bw.Write([byte]$headerSize)
    $bw.Write([byte]$headerSize)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]32)
    $bw.Write([UInt32]$png.Bytes.Length)
    $bw.Write([UInt32]$offset)
    $offset += $png.Bytes.Length
  }
  foreach ($png in $pngs) {
    $bw.Write($png.Bytes)
  }
} finally {
  $bw.Close()
  $fs.Close()
}

Write-Host $outPath
