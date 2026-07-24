<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$query = $_GET['q'] ?? '';
if (empty($query)) {
    echo json_encode(['error' => 'Missing query']);
    exit;
}

// ลองใช้ Invidious ก่อน (CORS-friendly)
$instances = [
    'https://invidious.jing.rocks',
    'https://inv.riverside.rocks',
    'https://yewtu.be',
    'https://invidious.nerdvpn.de',
    'https://invidious.lunar.icu',
];

foreach ($instances as $instance) {
    $url = "$instance/api/v1/search?q=" . urlencode($query) . "&type=video";
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 8);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode === 200 && $response) {
        echo $response;
        exit;
    }
}

// ถ้า Invidious ทั้งหมดล้มเหลว ลอง Piped ผ่าน proxy อีกที
$pipedUrl = "https://pipedapi.kavin.rocks/search?q=" . urlencode($query) . "&filter=videos&page=1";

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $pipedUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 8);
curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0');

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($httpCode === 200 && $response) {
    echo $response;
    exit;
}

echo json_encode(['error' => 'All instances failed']);
?>
