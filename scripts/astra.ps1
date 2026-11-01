# Starts a GPT-6 Astra pass in the Codex CLI at the repo root (docs/ASTRA.md, OPEN_QUESTIONS #44).
# Astra reads AGENTS.md, which sends it to docs/ASTRA.md. The workspace-write sandbox with network
# off keeps it away from testnet, NEAR AI Cloud and the hackathon's pages.
# -Effort: high for a pass (the default), max for a hard security or contract review.
param(
    [ValidateSet('low', 'medium', 'high', 'xhigh', 'max')]
    [string]$Effort = 'high'
)

$repo = Resolve-Path (Join-Path $PSScriptRoot '..')
$codex = Get-Command codex -ErrorAction SilentlyContinue
if (-not $codex) {
    $codex = Get-ChildItem "$env:LOCALAPPDATA\OpenAI\Codex\bin\*\codex.exe" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
if (-not $codex) { Write-Error 'Codex CLI not found. Install it or open the Codex app once.'; exit 1 }
$exe = if ($codex.Source) { $codex.Source } else { $codex.FullName }

Set-Location $repo
& $exe -m gpt-6-astra --sandbox workspace-write `
    -c "model_reasoning_effort=`"$Effort`"" `
    -c 'sandbox_workspace_write.network_access=false'
