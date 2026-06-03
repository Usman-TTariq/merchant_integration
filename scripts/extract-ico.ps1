Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$src = Join-Path $root "pos-machine-with-receipt-icon-in-orange-and-white-color-vector.ico"
$out = Join-Path $root "public\favicon-source.png"
$icon = [System.Drawing.Icon]::new($src, 256, 256)
$bmp = $icon.ToBitmap()
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$icon.Dispose()
$bmp.Dispose()
Write-Host "Saved 256x256 source PNG to $out"
