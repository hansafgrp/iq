<?php
// sheets_write.php — POST proxy to Apps Script (doPost)
// Expects JSON body: { key:'ADMIN_KEY', action:'upsert', ...fields }

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-store');

$APPS_SCRIPT = 'https://script.google.com/macros/s/AKfycbzxGyujeCMUbtGLykqOzPnzsJhv1lEms0mZSvCIZCPBGWHsvl1NkZa3JZ6xB90B10ohXA/exec';

function fail($code,$msg,$detail=null){
  http_response_code($code);
  $o=['ok'=>false,'error'=>$msg]; if($detail){$o['detail']=$detail;}
  echo json_encode($o); exit;
}

$raw = file_get_contents('php://input');
if(!$raw) fail(400,'Empty body');
$payload = json_decode($raw,true);
if(!is_array($payload)) fail(400,'Invalid JSON');

$ch = curl_init($APPS_SCRIPT);
curl_setopt_array($ch,[
  CURLOPT_RETURNTRANSFER=>true,
  CURLOPT_FOLLOWLOCATION=>true,
  CURLOPT_MAXREDIRS=>5,
  CURLOPT_TIMEOUT=>20,
  CURLOPT_HTTPHEADER=>['Content-Type: application/json','Accept: application/json'],
  CURLOPT_POST=>true,
  CURLOPT_POSTFIELDS=>json_encode($payload),
]);
$body = curl_exec($ch);
if($body===false){ $e=curl_error($ch); curl_close($ch); fail(502,'Write request failed',$e); }
$code=curl_getinfo($ch,CURLINFO_HTTP_CODE);
curl_close($ch);

http_response_code($code);
echo $body;
