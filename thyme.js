/**
 * Copyright (c) 2018, OCEAN, KETI
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * Created by Il Yeup, Ahn in KETI on 2016-08-19.
 */

global.resp_mqtt_ri_arr = [];

global.resp_mqtt_path_arr = {};
global.socket_q = {};

//fs.writeFileSync('aei.json', JSON.stringify(conf, null, 4), 'utf-8');

//global.sh_state = 'rtvae';
global.sh_state = 'crtae';

global.mqtt_client = null;

global.conf = {};

conf.cse = {};
conf.cse.host = '150.197.3.100'; //'203.253.128.161';
conf.cse.port = 7579;
conf.cse.mqttport = 1883;
conf.usesecure = 'disable';
conf.commLink = 'tcp'; //'udp'; //'tcp';

// AE core
conf.aei = "SgMavUTM"

conf.gcs = 'UTM_UVARC';

conf.drone = [];

var info = {};

// info = {};
// info.name = 'KETI_DIoT';
// info.gcs = conf.gcs;
// info.gcs_sys_id = 255;
// info.goto_position = [
//     'cancel' , '37.2737168:127.3643657:35:4' , '37.2727243:127.3647090:35:4' , '37.2732088:127.3667153:35:4' , '37.2741884:127.3663800:35:4'
// ];
// info.system_id = 10;
// conf.drone.push(info);

info = {};
info.name = 'UMACAir11';
info.gcs = conf.gcs;
info.gcs_sys_id = 255;
info.goto_position = [
    'cancel' , '37.2737168:127.3643657:35:4' , '37.2727243:127.3647090:35:4' , '37.2732088:127.3667153:35:4' , '37.2741884:127.3663800:35:4', '37.2737189:127.3650476:35:4', '37.2740423:127.3666234:35:4'
];
info.system_id = 11;
conf.drone.push(info);

info = {};
info.name = 'UMACAir12';
info.gcs = conf.gcs;
info.gcs_sys_id = 255;
info.goto_position = [
    'cancel' , '37.2737402:127.3645507:35:4' , '37.2727670:127.3648994:35:4' , '37.2732600:127.3668735:35:4' , '37.2742311:127.3665517:35:4' , '37.2737531:127.3652139:35:4', '37.2740593:127.3668809:35:4'
];
info.system_id = 12;
conf.drone.push(info);

info = {};
info.name = 'UMACAir13';
info.gcs = conf.gcs;
info.gcs_sys_id = 255;
info.goto_position = [
    'cancel' , '37.2738491:127.3643254:40:4' , '37.2728801:127.3646500:40:4' , '37.2733390:127.3666402:40:4' , '37.2743315:127.3663451:40:4' , '37.2738512:127.3649939:40:4', '37.2741533:127.3666260:40:4'
];
info.system_id = 13;
conf.drone.push(info);

info = {};
info.name = 'UMACAir14';
info.gcs = conf.gcs;
info.gcs_sys_id = 255;
info.goto_position = [
    'cancel' , '37.2738939:127.3644756:40:4' , '37.2729249:127.3648404:40:4' , '37.2733859:127.3668199:40:4' , '37.2743635:127.3664819:40:4', '37.2739003:127.3651629:40:4', '37.2741981:127.3668218:40:4'
];
info.system_id = 14;
conf.drone.push(info);

conf.running_type = 'local';        // 'local' or 'global' : When this is worked in Server, select 'global'

conf.use_terminal = 'disable'; //'enable';


if(conf.use_terminal === 'enable') {
    require('./terminal_app');
}
else {
    require('./http_app');
}

