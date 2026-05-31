$xml = [xml](Get-Content 'F:\1\dianshang\.tmp\modelrouter-doc\extracted\word\document.xml' -Encoding UTF8)
$paragraphs = $xml.SelectNodes('//*[local-name()="p"]')
$result = @()
foreach ($p in $paragraphs) {
    $texts = $p.SelectNodes('.//*[local-name()="t"]') | ForEach-Object { $_.InnerText }
    $result += ($texts -join '')
}
$result -join "`r`n" | Out-File -FilePath 'F:\1\dianshang\.tmp\modelrouter-doc\extracted.txt' -Encoding UTF8
Write-Host "Done. Lines: $($result.Count)"
