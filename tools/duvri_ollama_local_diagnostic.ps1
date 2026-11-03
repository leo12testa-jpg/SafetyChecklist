# Colligo DUVRI AI — Ollama read-only local diagnostic (NO downloads or API costs)
# PowerShell 5.1+. Does NOT configure Ollama, change environment or pull models.
$ErrorActionPreference = 'Stop'
$envLevels = @('Process','User','Machine')
$cloudEnvs = @()
$hostEnvs = @()
foreach ($level in $envLevels) {
    $cloudEnvs += [Environment]::GetEnvironmentVariable('OLLAMA_NO_CLOUD', $level)
    $hostEnvs += [Environment]::GetEnvironmentVariable('OLLAMA_HOST', $level)
}
# Process overrides user, which overrides machine. A lower-priority '1'
# must NOT mask a higher-priority value of '0'.
$effectiveCloud = @($cloudEnvs | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    Select-Object -First 1)
$cloudEnvConfigured = ($effectiveCloud.Count -gt 0 -and $effectiveCloud[0] -eq '1')
$customHosts = @($hostEnvs | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$unsafeHost = @($customHosts | Where-Object {
    $_ -notmatch '^(?i:(?:https?://)?(?:127\.0\.0\.1|localhost))(?::11434)?$'
}).Count -gt 0
$configPresent = $false
$configDisabled = $false
$configReadable = $true
$configPath = Join-Path $env:USERPROFILE '.ollama\server.json'
if (Test-Path -LiteralPath $configPath -PathType Leaf) {
    $configPresent = $true
    try {
        $cfg = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
        $configDisabled = ($cfg.disable_ollama_cloud -eq $true)
    } catch {
        $configReadable = $false
    }
}
$exePresent = ($null -ne (Get-Command ollama -ErrorAction SilentlyContinue))
$ollamaRunning = $false
$models = @()
$apiError = $null
try {
    # GET local models only. Never POST, pull, install, sign in, create, or chat.
    $answer = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5 -MaximumRedirection 0
    if ($null -ne $answer.models) {
        $models = @($answer.models | ForEach-Object { [string]$_.name } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }
    $ollamaRunning = $true
} catch {
    $apiError = 'LOCAL_OLLAMA_NOT_RESPONDING'
}
$memoryGb = $null
$gpuNames = @()
try {
    $memoryGb = [math]::Round((Get-CimInstance -ClassName Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
    $gpuNames = @(Get-CimInstance -ClassName Win32_VideoController |
        Select-Object -ExpandProperty Name -ErrorAction SilentlyContinue)
} catch {
    # Hardware inventory may be disabled by policy. It is not a blocker.
}
$noCloudConfigured = ($cloudEnvConfigured -or $configDisabled)
$localAllowed = $exePresent -and $ollamaRunning -and
    $noCloudConfigured -and $configReadable -and (-not $unsafeHost) -and
    (@($models | Where-Object { $_ -notmatch '(?i)cloud' }).Count -gt 0)
$state = if (-not $exePresent) { 'OLLAMA_CLI_MISSING' }
    elseif (-not $ollamaRunning) { 'LOCAL_OLLAMA_UNAVAILABLE' }
    elseif ($unsafeHost) { 'OLLAMA_HOST_NOT_LOOPBACK' }
    elseif (-not $configReadable) { 'CLOUD_CONFIG_UNREADABLE' }
    elseif (-not $noCloudConfigured) { 'CLOUD_DISABLE_NOT_CONFIGURED' }
    elseif ($models.Count -eq 0) { 'NO_MODELS_INSTALLED' }
    elseif (-not $localAllowed) { 'NO_LOCAL_MODEL_AVAILABLE' }
    else { 'CONFIGURED_BUT_EFFECTIVE_RUNTIME_STILL_REQUIRES_LOG_VERIFICATION' }
[ordered]@{
    status = $state
    diagnostic_only = $true
    ollama_cli_present = $exePresent
    localhost_api_responding = $ollamaRunning
    cloud_disable_configured = $noCloudConfigured
    # A configuration flag alone does NOT prove the running service has
    # loaded it. Verify the Ollama log reports "Ollama cloud disabled: true".
    cloud_disabled_effectively_verified = $false
    server_json_present = $configPresent
    server_json_readable = $configReadable
    loopback_binding_configuration_ok = (-not $unsafeHost)
    local_model_names = @($models | Where-Object { $_ -notmatch '(?i)cloud' })
    cloud_model_count_rejected = @($models | Where-Object { $_ -match '(?i)cloud' }).Count
    ram_gb = $memoryGb
    gpu_names = @($gpuNames)
    local_api_error_code = $apiError
} | ConvertTo-Json -Depth 4
