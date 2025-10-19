<?php
// proxy.php â€” CORS relay for Transline Admin to Google Apps Script
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(200);
  exit;
}

// ðŸ”— your live Apps Script deployment URL (ends with /exec)
$APP_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzijlYhGns76DpxCqaFZOpuoDEYNC-PNh0gPHDmD9BO7y19J5xC1MS5lJm6Q3XKXoth5w/exec';

// Forward POST body and follow redirects
$body = file_get_contents('php://input');
$ch = curl_init($APP_SCRIPT_URL);
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_FOLLOWLOCATION => true,   // ðŸ‘ˆ follow 302 redirects!
  CURLOPT_MAXREDIRS      => 5,
  CURLOPT_POST           => true,
  CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
  CURLOPT_POSTFIELDS     => $body,
  CURLOPT_TIMEOUT        => 20,
]);
$response = curl_exec($ch);
$httpcode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err = curl_error($ch);
curl_close($ch);

if ($err) {
  http_response_code(502);
  echo json_encode(["ok"=>false,"error"=>"Curl error: $err"]);
  exit;
}
if ($httpcode >= 400) {
  http_response_code($httpcode);
  echo json_encode(["ok"=>false,"error"=>"Proxy failed: HTTP $httpcode"]);
  exit;
}

// detect unexpected HTML (login / error page)
if (stripos($response, '<html') !== false) {
  echo json_encode(["ok"=>false,"error"=>"Apps Script returned HTML (check deployment link or permissions)"]);
  exit;
}

header("Content-Type: application/json");
echo $response;
