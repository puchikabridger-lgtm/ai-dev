param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Args
)

$script = Join-Path $PSScriptRoot "aidev.py"
python $script @Args
