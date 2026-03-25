$f = "functions/src/index.ts"
$c = Get-Content -Path $f -Raw
# First replace the regex literal with a more generic one that doesn't care about the dashes
$c = $c -replace '010-\\d\{4\}-\\d\{4\}', '010\d{8}'
$c = $c -replace '010-0000-0000', '01000000000'
$c = $c -replace 'phone\.split\(''-''\)\.pop\(\) \|\| ''''', 'phone.slice(-4)'
Set-Content -Path $f -Value $c -Encoding utf8
