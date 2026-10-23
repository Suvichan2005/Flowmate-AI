param([int]$VitePort = 5195)
$ErrorActionPreference = 'Stop'

# Start the browser side of the two-profile sync acceptance only after the
# dedicated Auth and Firestore demo emulators are reachable. The emulators are
# started separately with firebase.sync-demo.json and the same demo project ID.
$projectId = 'demo-flowmate-sync'
$expectedPorts = @(9099, 18080)
foreach ($requiredPort in $expectedPorts) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $result = $client.BeginConnect('127.0.0.1', $requiredPort, $null, $null)
        if (-not $result.AsyncWaitHandle.WaitOne(1500)) {
            throw "Required demo emulator port $requiredPort is not listening. Start Auth and Firestore with firebase.sync-demo.json first."
        }
        $client.EndConnect($result)
    }
    finally {
        $client.Dispose()
    }
}

$env:GCLOUD_PROJECT = $projectId
$env:FIREBASE_PROJECT = $projectId
$env:VITE_SYNC_DEMO_MODE = 'true'
$env:VITE_USE_FIREBASE_EMULATORS = 'true'
$env:VITE_FIREBASE_PROJECT_ID = $projectId
$env:VITE_FIREBASE_API_KEY = 'demo-api-key'
$env:VITE_FIREBASE_AUTH_DOMAIN = '127.0.0.1'
$env:VITE_FIREBASE_APP_ID = '1:000000000000:web:flowmate-sync-demo'
$env:VITE_FIREBASE_STORAGE_BUCKET = "$projectId.appspot.com"
$env:VITE_FIREBASE_MESSAGING_SENDER_ID = '000000000000'
$env:VITE_MANAGED_AI_ENDPOINT = ''
$env:VITE_MANAGED_LIVE_RELAY_ENDPOINT = ''

if ($env:VITE_FIREBASE_PROJECT_ID -ne $projectId -or $env:VITE_USE_FIREBASE_EMULATORS -ne 'true' -or
    $env:VITE_SYNC_DEMO_MODE -ne 'true' -or
    -not [string]::IsNullOrEmpty($env:VITE_MANAGED_AI_ENDPOINT) -or
    -not [string]::IsNullOrEmpty($env:VITE_MANAGED_LIVE_RELAY_ENDPOINT)) {
    throw 'Sync demo target failed its isolation preflight.'
}

npm run dev -- --host 127.0.0.1 --port $VitePort --strictPort
