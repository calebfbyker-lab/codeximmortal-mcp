#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Server = '127.0.0.1',

    [ValidateRange(1, 65535)]
    [int]$Port = 5432,

    [ValidatePattern('^[a-z][a-z0-9_]{0,62}$')]
    [string]$Database = 'codex_growth_dev',

    [ValidatePattern('^[a-zA-Z_][a-zA-Z0-9_]{0,62}$')]
    [string]$Username = 'postgres',

    [string]$PsqlPath = 'C:\Program Files\PostgreSQL\16\bin\psql.exe',

    [Security.SecureString]$Password,

    [switch]$CreateDatabase,

    [Parameter(Mandatory = $true)]
    [switch]$ConfirmDisposableDatabase,

    [string]$LogDirectory = (
        Join-Path ([IO.Path]::GetTempPath()) 'codeximmortal-growth-setup'
    )
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$logFile = $null
$passwordPointer = [IntPtr]::Zero
$plainPassword = $null

$environmentNames = @(
    'PGPASSWORD',
    'PGCONNECT_TIMEOUT',
    'PGOPTIONS',
    'PGSERVICE',
    'PGSERVICEFILE'
)

$previousEnvironment = @{}
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] =
        [Environment]::GetEnvironmentVariable($name, 'Process')
}

function Write-SetupLog {
    param(
        [string]$Level,
        [string]$Message
    )

    $line = '{0} [{1}] {2}' -f (
        [DateTime]::UtcNow.ToString('o')
    ), $Level, $Message

    Write-Host $line
    if ($script:logFile) {
        Add-Content -LiteralPath $script:logFile `
            -Value $line -Encoding UTF8
    }
}

function Invoke-CheckedPsql {
    param(
        [string]$TargetDatabase,
        [string[]]$ExtraArguments,
        [string]$Stage
    )

    $arguments = @(
        '-X',
        '--no-password',
        '--host', $Server,
        '--port', "$Port",
        '--username', $Username,
        '--dbname', $TargetDatabase,
        '--set', 'ON_ERROR_STOP=1',
        '--tuples-only',
        '--no-align'
    ) + $ExtraArguments

    # Capture output, but do not write raw server diagnostics to the log.
    # SQL errors can contain statement text or other sensitive information.
    $savedErrorPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $captured = @(& $PsqlPath @arguments 2>&1)
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $savedErrorPreference
    }

    if ($code -ne 0) {
        throw "$Stage failed (psql exit $code). Check credentials, database permissions, and server availability."
    }

    return (($captured | ForEach-Object { "$_" }) -join "`n").Trim()
}

try {
    if (-not $ConfirmDisposableDatabase.IsPresent) {
        throw 'Explicit disposable-database confirmation is required.'
    }

    if ($Database -in @('postgres', 'template0', 'template1')) {
        throw 'Use a dedicated development database, not a system database.'
    }

    if (-not (Test-Path -LiteralPath $PsqlPath -PathType Leaf)) {
        throw 'psql.exe was not found. Supply its actual location with -PsqlPath.'
    }

    $migration007 = Join-Path $repoRoot 'migrations\007_growth_runtime.sql'
    $migration008 = Join-Path $repoRoot 'migrations\008_growth_candidates.sql'

    foreach ($file in @($migration007, $migration008)) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
            throw 'A required growth migration is missing from this checkout.'
        }
    }

    New-Item -ItemType Directory -Path $LogDirectory -Force |
        Out-Null

    $logName = 'growth-setup-{0}-{1}.log' -f (
        Get-Date -Format 'yyyyMMdd-HHmmss'
    ), ([Guid]::NewGuid().ToString('N').Substring(0, 8))

    $logFile = Join-Path $LogDirectory $logName
    New-Item -ItemType File -Path $logFile | Out-Null
    Write-SetupLog 'INFO' 'Starting local PostgreSQL setup verification.'

    if ($Password) {
        $passwordPointer =
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)

        $plainPassword =
            [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
                $passwordPointer
            )

        if ([string]::IsNullOrEmpty($plainPassword)) {
            throw 'An empty password is not allowed.'
        }

        [Environment]::SetEnvironmentVariable(
            'PGPASSWORD', $plainPassword, 'Process'
        )

        $plainPassword = $null
    }
    elseif ([string]::IsNullOrEmpty($env:PGPASSWORD)) {
        throw 'Supply -Password as a SecureString or provide PGPASSWORD privately before running.'
    }

    # Avoid inherited service definitions or options changing the connection.
    foreach ($name in @('PGSERVICE', 'PGSERVICEFILE')) {
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }

    $env:PGCONNECT_TIMEOUT = '5'
    $env:PGOPTIONS = '-c statement_timeout=30000 -c lock_timeout=5000'

    $connected = Invoke-CheckedPsql `
        -TargetDatabase 'postgres' `
        -ExtraArguments @('--command', 'SELECT 1;') `
        -Stage 'Administrator connection check'

    if ($connected -ne '1') {
        throw 'Unexpected connection-check result.'
    }

    Write-SetupLog 'PASS' 'Authenticated PostgreSQL connection.'

    # Database is restricted to a simple lowercase identifier by validation.
    $exists = Invoke-CheckedPsql `
        -TargetDatabase 'postgres' `
        -ExtraArguments @(
            '--command',
            "SELECT count(*) FROM pg_database WHERE datname = '$Database';"
        ) `
        -Stage 'Database existence check'

    if ($exists -eq '0') {
        if (-not $CreateDatabase.IsPresent) {
            throw 'Dedicated database does not exist. Re-run with -CreateDatabase to authorize creation.'
        }

        $null = Invoke-CheckedPsql `
            -TargetDatabase 'postgres' `
            -ExtraArguments @(
                '--command',
                "CREATE DATABASE $Database;"
            ) `
            -Stage 'Dedicated database creation'

        Write-SetupLog 'PASS' 'Created dedicated development database.'
    }
    elseif ($exists -ne '1') {
        throw 'Unexpected database existence-check result.'
    }

    $null = Invoke-CheckedPsql `
        -TargetDatabase $Database `
        -ExtraArguments @('--command', 'SELECT 1;') `
        -Stage 'Target database connection check'

    Write-SetupLog 'PASS' 'Connected to target development database.'

    # Do not infer that an existing schema is valid from one table's presence.
    # This initial-setup script fails closed instead of replaying migrations.
    $schemaExists = Invoke-CheckedPsql `
        -TargetDatabase $Database `
        -ExtraArguments @(
            '--command',
            "SELECT count(*) FROM pg_namespace WHERE nspname = 'growth_runtime';"
        ) `
        -Stage 'Existing schema check'

    if ($schemaExists -ne '0') {
        throw 'growth_runtime already exists. No migrations applied; inspect its state before making changes.'
    }

    foreach ($migration in @($migration007, $migration008)) {
        $name = Split-Path -Leaf $migration
        $hash = (Get-FileHash -LiteralPath $migration -Algorithm SHA256).Hash

        Write-SetupLog 'INFO' "Applying $name; SHA256=$hash"

        $null = Invoke-CheckedPsql `
            -TargetDatabase $Database `
            -ExtraArguments @('--file', $migration) `
            -Stage "Migration $name"

        Write-SetupLog 'PASS' "Applied $name."
    }

    $verificationSql = @'
SELECT
    to_regclass('growth_runtime.policy') IS NOT NULL
    AND to_regclass('growth_runtime.runs') IS NOT NULL
    AND to_regclass('growth_runtime.events') IS NOT NULL
    AND to_regclass('growth_runtime.candidates') IS NOT NULL;
'@

    $verified = Invoke-CheckedPsql `
        -TargetDatabase $Database `
        -ExtraArguments @('--command', $verificationSql) `
        -Stage 'Migration table verification'

    if ($verified -ne 't') {
        throw 'Expected growth tables were not all found.'
    }

    $paused = Invoke-CheckedPsql `
        -TargetDatabase $Database `
        -ExtraArguments @(
            '--command',
            'SELECT paused FROM growth_runtime.policy WHERE singleton = true;'
        ) `
        -Stage 'Paused policy verification'

    if ($paused -ne 't') {
        throw 'Growth policy is not paused as expected.'
    }

    Write-SetupLog 'PASS' 'Expected tables exist and growth dispatch remains paused.'
    Write-SetupLog 'INFO' 'No inference, agent reviews, code releases, or authentication changes performed.'
    Write-SetupLog 'SUCCESS' 'Database setup verification completed.'
}
catch {
    # Only controlled stage messages are logged; raw psql output is withheld.
    Write-SetupLog 'FAIL' 'Setup did not complete successfully.'
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host 'If migration 008 failed after 007 succeeded, the database is partially initialized; do not blindly replay migrations.'
    throw 'PostgreSQL setup failed. Review the stage log and local configuration.'
}
finally {
    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable(
            $name, $previousEnvironment[$name], 'Process'
        )
    }

    if ($passwordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }

    $plainPassword = $null

    if ($logFile) {
        Write-Host "Verification log: $logFile"
    }
}
