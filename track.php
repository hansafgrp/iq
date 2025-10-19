<?php
/**
 * track.php — Sheet-first + Delhivery (AWB & ORDER-ID via ref_ids)
 *
 * Behavior:
 * - ?awb=...                    → Delhivery by waybill (tries Surface then Express, unless service=... hint)
 * - ?id=...                     → Delhivery by ref_ids FIRST; if no data, fall back to Sheet(ID→AWB) → Delhivery
 * - ?service=surface|express    → Hint which token to try first
 * - ?selftest=1                 → sanity output
 *
 * Keep index.html and sheets.php as-is.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

// ===== TOKENS (quick & clear) =====
// TODO: paste your real tokens here (leave unused as '')
$SURFACE_TOKEN = '24ffef51e1c28c1a78b69ccb96d199e2e038a29a';
$EXPRESS_TOKEN = '74c5706d33c53c299bbd846814eebf5aa3d0b8f2';

// Auth style: most accounts use "Authorization: Token <token>"
// If Express needs Bearer, change to 'Bearer'
$AUTH_STYLE = 'Token';

// Delhivery production base templates
$AWB_TPL   = 'https://track.delhivery.com/api/v1/packages/json/?waybill=%s';  // waybill (csv ok)
$ORDER_TPL = 'https://track.delhivery.com/api/v1/packages/json/?ref_ids=%s'; // order id(s) (csv ok)

// ---- Helpers ----
function fail($code,$msg,$detail=null){
  http_response_code($code);
  $o=['error'=>$msg]; if($detail){$o['detail']=$detail;} echo json_encode($o); exit;
}
function http_get($url,$headers=[],$timeout=20){
  $ch=curl_init($url);
  curl_setopt_array($ch,[
    CURLOPT_RETURNTRANSFER=>true,
    CURLOPT_FOLLOWLOCATION=>true,
    CURLOPT_MAXREDIRS=>5,
    CURLOPT_TIMEOUT=>$timeout,
    CURLOPT_HTTPHEADER=>$headers,
  ]);
  $b=curl_exec($ch);
  if($b===false){$e=curl_error($ch);curl_close($ch);return[null,0,$e];}
  $c=curl_getinfo($ch,CURLINFO_HTTP_CODE);
  curl_close($ch);
  return[$b,$c,null];
}
function ok_json($body){
  $j=json_decode($body,true);
  return (is_array($j)&&isset($j['ShipmentData'])&&count($j['ShipmentData'])>0)?$j:null;
}
function auth_header_variants($token,$style){
  // Try a few header shapes to cover Express quirks
  $order = ($style==='Bearer')? ['Bearer','Token','TokenToken','X']
         : (($style==='X')    ? ['X','Token','TokenToken','Bearer']
                               : ['Token','TokenToken','Bearer','X']);
  $list=[];
  foreach($order as $s){
    if($s==='Bearer')     $list[] = ["Authorization: Bearer $token",'Accept: application/json'];
    elseif($s==='X')      $list[] = ["X-Authorization-Token: $token",'Accept: application/json'];
    elseif($s==='TokenToken') $list[] = ["Authorization: Token token=$token",'Accept: application/json'];
    else                  $list[] = ["Authorization: Token $token",'Accept: application/json'];
  }
  return $list;
}
function call_dlv_csv($tpl,$csv,$token,$style){
  if($token==='') return null;
  $url = sprintf($tpl, urlencode($csv));
  foreach(auth_header_variants($token,$style) as $hdrs){
    [$b,$c,$e] = http_get($url,$hdrs);
    if($e!==null) continue;
    if($c>=300)   continue;
    $ok=ok_json($b);
    if($ok) return $ok;
  }
  return null;
}
function resolve_awb_from_sheet($val){
  // Uses your working sheets proxy
  $host=(isset($_SERVER['HTTPS'])&&$_SERVER['HTTPS']==='on'?'https://':'http://').($_SERVER['HTTP_HOST']??'');
  $url=$host.'/sheets.php?id='.urlencode($val);
  [$b,$c,$e]=http_get($url,['Accept: application/json']);
  if($e===null && $c<300){
    $j=json_decode($b,true);
    if(is_array($j) && !empty($j['ok']) && !empty($j['data']['awb'])) return trim($j['data']['awb']);
  }
  return null;
}

// ---- Selftest ----
if(isset($_GET['selftest'])){
  echo json_encode([
    'ok'=>true,
    'diag'=>[
      'surface_token_present'=>$SURFACE_TOKEN!=='',
      'express_token_present'=>$EXPRESS_TOKEN!=='',
      'auth_header_format'=>$AUTH_STYLE,
      'sheets_proxy'=>'/sheets.php'
    ]
  ]);
  exit;
}

// ---- Inputs ----
$awbRaw  = isset($_GET['awb'])?trim($_GET['awb']):'';
$idRaw   = isset($_GET['id']) ?trim($_GET['id']) :'';
$hint    = isset($_GET['service'])?strtolower(trim($_GET['service'])):'';

// Normalize CSVs (max 50; API supports up to 50)
$csvize = function($s){
  $arr = array_values(array_filter(array_map('trim', explode(',',$s)), fn($x)=>$x!==''));
  if(count($arr)>50) fail(400,'Too many values (max 50)');
  return [ $arr, implode(',',$arr) ];
};

if($awbRaw==='' && $idRaw==='') fail(400,'Missing awb or id');

// Decide call order based on hint + available tokens
$seq=[];
if($hint==='surface' && $SURFACE_TOKEN!=='') $seq=['surface','express'];
elseif($hint==='express' && $EXPRESS_TOKEN!=='') $seq=['express','surface'];
else {
  if($SURFACE_TOKEN!=='') $seq[]='surface';
  if($EXPRESS_TOKEN!=='') $seq[]='express';
}
if(!$seq) fail(502,'Delhivery request failed','No tokens present');

$errors=[];

// CASE 1: ORDER ID PROVIDED → try Delhivery ref_ids FIRST
if($idRaw!==''){
  list($ids,$idCsv) = $csvize($idRaw);

  foreach($seq as $p){
    $token = ($p==='surface') ? $SURFACE_TOKEN : $EXPRESS_TOKEN;
    $ok = call_dlv_csv($ORDER_TPL,$idCsv,$token,$AUTH_STYLE); // <-- ref_ids first
    if($ok){ echo json_encode($ok); exit; }
    $errors[] = "$p(ref_ids): no data";
  }

  // Fallback: resolve first ID via sheet → AWB → Delhivery by waybill
  $resolved = resolve_awb_from_sheet($ids[0]);
  if($resolved){
    list($awbs,$awbCsv) = $csvize($resolved);
    foreach($seq as $p){
      $token = ($p==='surface') ? $SURFACE_TOKEN : $EXPRESS_TOKEN;
      $ok = call_dlv_csv($AWB_TPL,$awbCsv,$token,$AUTH_STYLE);
      if($ok){ echo json_encode($ok); exit; }
      $errors[] = "$p(sheet→awb): no data";
    }
    fail(404,'No data found for this Order ID', implode(' | ',$errors));
  } else {
    fail(404,'No data found for this Order ID','Sheet did not return AWB');
  }
}

// CASE 2: AWB PROVIDED → normal waybill flow
list($awbs,$awbCsv) = $csvize($awbRaw);
foreach($seq as $p){
  $token = ($p==='surface') ? $SURFACE_TOKEN : $EXPRESS_TOKEN;
  $ok = call_dlv_csv($AWB_TPL,$awbCsv,$token,$AUTH_STYLE);
  if($ok){ echo json_encode($ok); exit; }
  $errors[] = "$p(awb): no data";
}

fail(502,'Delhivery request failed', implode(' | ',$errors));
