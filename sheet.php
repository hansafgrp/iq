<?php
// sheets.php — proxy to Apps Script tracking
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-store');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: max-age=45, stale-while-revalidate=90');

$APPS_SCRIPT = 'https://script.google.com/macros/s/AKfycbYOURDEPLOYID/exec'; // same as BACKEND

function http_get($url){
  $ch=curl_init($url);
  curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_FOLLOWLOCATION=>true]);
  $out=curl_exec($ch); $code=curl_getinfo($ch,CURLINFO_HTTP_CODE); curl_close($ch);
  return [$out,$code];
}

if(isset($_GET['id'])||isset($_GET['awb'])){
  $param = isset($_GET['id']) ? 'id=' . urlencode($_GET['id']) : 'awb=' . urlencode($_GET['awb']);
  list($b,$c)=http_get($APPS_SCRIPT.'?'.$param);
  http_response_code($c);
  echo $b;
  exit;
}

echo json_encode(['ok'=>false,'error'=>'No ID or AWB provided']);

