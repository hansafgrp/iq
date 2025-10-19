<?php
/**
 * config.php — Delhivery credentials
 * Encoding: UTF-8 (no BOM). No spaces/lines before <?php
 * Path: public_html/translinelogistics.in/config.php
 */

define('24ffef51e1c28c1a78b69ccb96d199e2e038a29a', '');   // <- paste your Surface token
define('74c5706d33c53c299bbd846814eebf5aa3d0b8f2', '');   // <- paste your Express token

/* Most Delhivery accounts use this:
   "Authorization: Token <token>"
   If your Express doc says Bearer, change to 'Bearer'. */
define('DLV_AUTH_HEADER', 'Token');

/* Production endpoints (don’t change unless Delhivery gave different URLs) */
define('DLV_AWB_ENDPOINT',   'https://track.delhivery.com/api/v1/packages/json/?waybill=%s');  // waybill
// (Optional) if your account supports order lookup directly (ref_ids), add one day:
// define('DLV_ORDER_ENDPOINT','https://track.delhivery.com/api/v1/packages/json/?ref_ids=%s');
