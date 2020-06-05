/**
 * Copyright (c) 2018, OCEAN
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * Created by Il Yeup, Ahn in KETI on 2019-07-01.
 */

var fs = require('fs');
var mqtt = require('mqtt');

var net = require('net');
var udp = require('dgram');


mqtt_connect(conf.cse.host);

function mqtt_connect(serverip) {
    if(mqtt_client == null) {
        if (conf.usesecure === 'disable') {
            var connectOptions = {
                host: serverip,
                port: conf.cse.mqttport,
//              username: 'keti',
//              password: 'keti123',
                protocol: "mqtt",
                keepalive: 10,
//              clientId: serverUID,
                protocolId: "MQTT",
                protocolVersion: 4,
                clean: true,
                reconnectPeriod: 2000,
                connectTimeout: 2000,
                rejectUnauthorized: false
            };
        }
        else {
            connectOptions = {
                host: serverip,
                port: conf.cse.mqttport,
                protocol: "mqtts",
                keepalive: 10,
//              clientId: serverUID,
                protocolId: "MQTT",
                protocolVersion: 4,
                clean: true,
                reconnectPeriod: 2000,
                connectTimeout: 2000,
                key: fs.readFileSync("./server-key.pem"),
                cert: fs.readFileSync("./server-crt.pem"),
                rejectUnauthorized: false
            };
        }

        mqtt_client = mqtt.connect(connectOptions);
    }

    mqtt_client.on('connect', function () {
        if(conf.running_type === 'local') {
            for (var idx in conf.drone) {
                if (conf.drone.hasOwnProperty(idx)) {
                    var noti_topic = '/Mobius/' + conf.drone[idx].gcs + '/Drone_Data/' + conf.drone[idx].name + '/#';
                    mqtt_client.subscribe(noti_topic);
                    console.log(noti_topic);
                }
            }
        }
        else if(conf.running_type === 'global') {
            retrieve_drone();
        }
        else {
            console.log('[mqtt_client.on] conf.running_type is incorrect');
        }
    });

    mqtt_client.on('message', function (topic, message) {
        if(message[0] == 0xfe || message[0] == 0xfd) {
            send_to_gcs(message);
        }
    });

    mqtt_client.on('error', function (err) {
        console.log(err.message);
    });
}

function retrieve_drone() {
    rtvct('/Mobius/UTM/gMavUTM/la', 'SgMavUTM', 0, function (rsc, res_body, count) {
        if(rsc == 2000) {
            conf.drone = [];
            conf.drone = JSON.parse(JSON.stringify(res_body[Object.keys(res_body)[0]].con)).drone;
            for (var idx in conf.drone) {
                if (conf.drone.hasOwnProperty(idx)) {
                    var noti_topic = '/Mobius/' + conf.drone[idx].gcs + '/Drone_Data/' + conf.drone[idx].name + '/#';
                    mqtt_client.subscribe(noti_topic);
                    console.log(noti_topic);
                }
            }
        }
        else {
            console.log('[retrieve_drone] x-m2m-rsc : ' + rsc + ' <----' + res_body);
            setTimeout(retrieve_drone, 10000);
        }
    });
}


var gcs_content = {};

var udpClient = null;
var utm_socket = null;

if(conf.commLink == 'udp') {
    if(udpClient == null) {
        udpClient = udp.createSocket('udp4');

        udpClient.on('message', from_gcs);
    }
}
else if(conf.commLink == 'tcp') {
    var _server = net.createServer(function (socket) {
        console.log('socket connected');

        utm_socket = socket;

        socket.on('data', from_gcs);

        socket.on('end', function() {
            console.log('end');
        });

        socket.on('close', function() {
            console.log('close');
            utm_socket = null;
        });

        socket.on('error', function(e) {
            console.log('error ', e);
        });
    });

    if(conf.running_type === 'local') {
        _server.listen(5760, function () {
            console.log('TCP Server for local GCS is listening on port 5760');
        });
    }
    else if(conf.running_type === 'global') {
        _server.listen(7598, function () {
            console.log('TCP Server for global GCS is listening on port 7598');
        });
    }
    else {
        console.log('[server.listen] conf.running_type is incorrect');
    }
}


function from_gcs (msg) {
    var content = new Buffer.from(msg, 'ascii').toString('hex');
    var ver = content.substr(0, 2).toLowerCase();
    if(ver == 'fd') {
        var sysid = content.substr(10, 2).toLowerCase();
        var msgid = content.substr(14, 6).toLowerCase();

        gcs_content[sysid + '-' + msgid + '-' + ver] = content;
    }
    else {
        sysid = content.substr(6, 2).toLowerCase();
        msgid = content.substr(10, 2).toLowerCase();

        gcs_content[sysid + '-' + msgid + '-' + ver] = content;
    }

    for(var idx in conf.drone) {
        if (conf.drone.hasOwnProperty(idx)) {
            if (parseInt(sysid, 16) == conf.drone[idx].gcs_sys_id) {
                var parent = '/Mobius/' + conf.drone[idx].gcs + '/GCS_Data/' + conf.drone[idx].name;
                mqtt_client.publish(parent, msg);
            }
        }
    }

    if(msgid == '2c') {
        console.log('<-- 2c MISSION_COUNT - ' + content);
    }

    else if(msgid == '28') {
        console.log('<-- 28 MISSION_REQ - ' + content);
    }

    else if(msgid == '2f') {
        console.log('<-- 2f MISSION_ACK - ' + content);
    }

    else if(msgid == '33') {
        console.log('<-- 33 MISSION_REQ_INT - ' + content);
    }

    else if(msgid == '49') {
        console.log('<-- 49 MISSION_ITEM_INT - ' + content);
    }

    else if(msgid == '27') {
        console.log('<-- 27 MISSION_ITEM - ' + content);
    }
}

function send_to_gcs(content_each) {
    if(utm_socket != null) {
        utm_socket.write(content_each);
        //console.log(content_each);
    }
    else if(udpClient != null) {
        udpClient.send(content_each, 14550, 'localhost', function (error) {
            if (error) {
                udpClient.close();
                console.log('udpClient socket is closed');
            }
        });
    }

    if (utm_socket != null || udpClient != null) {
        content_each = content_each.toString('hex');
        var ver = content_each.substr(0, 2);
        if (ver == 'fd') {
            var sysid = content_each.substr(10, 2).toLowerCase();
            var msgid = content_each.substr(14, 6).toLowerCase();
        }
        else {
            sysid = content_each.substr(6, 2).toLowerCase();
            msgid = content_each.substr(10, 2).toLowerCase();
        }

        // if(sysid == '37' ) {
        //     console.log('55 - ' + content_each);
        // }
        // else if(sysid == '0a' ) {
        //     console.log('10 - ' + content_each);
        // }
        // else if(sysid == '21' ) {
        //     console.log('33 - ' + content_each);
        // }
        // else if(sysid == 'ff' ) {
        //     console.log('255 - ' + content_each);
        // }

        if (msgid == '2c') {
            console.log('2c MISSION_COUNT - ' + content_each);
        }

        else if (msgid == '28') {
            console.log('28 MISSION_REQ - ' + content_each);
        }

        else if (msgid == '2f') {
            console.log('2f MISSION_ACK - ' + content_each);
        }

        else if (msgid == '33') {
            console.log('33 MISSION_REQ_INT - ' + content_each);
        }

        else if (msgid == '49') {
            console.log('49 MISSION_ITEM_INT - ' + content_each);
        }

        // else if (msgid == '00') {
        //     console.log('2c MISSION_COUNT - ' + content_each);
        // }
    }
}

function rtvct(target, aei, count, callback) {
    http_request(aei, target, 'get', '', '', function (rsc, res_body) {
        callback(rsc, res_body, count);
    });
}

function http_request(origin, path, method, ty, bodyString, callback) {
    var options = {
        hostname: conf.cse.host,
        port: conf.cse.port,
        path: path,
        method: method,
        headers: {
            'X-M2M-RI': require('shortid').generate(),
            'Accept': 'application/json',
            'X-M2M-Origin': origin,
            'Locale': 'en'
        }
    };

    if(bodyString.length > 0) {
        options.headers['Content-Length'] = bodyString.length;
    }

    if(method === 'post') {
        var a = (ty==='') ? '': ('; ty='+ty);
        options.headers['Content-Type'] = 'application/vnd.onem2m-res+' + conf.ae.bodytype + a;
    }
    else if(method === 'put') {
        options.headers['Content-Type'] = 'application/vnd.onem2m-res+' + conf.ae.bodytype;
    }

    if(conf.usesecure === 'enable') {
        options.ca = fs.readFileSync('ca-crt.pem');
        options.rejectUnauthorized = false;

        var http = require('https');
    }
    else {
        http = require('http');
    }

    var res_body = '';
    var jsonObj = {};
    var req = http.request(options, function (res) {
        //console.log('[crtae response : ' + res.statusCode);

        //res.setEncoding('utf8');

        res.on('data', function (chunk) {
            res_body += chunk;
        });

        res.on('end', function () {
            try {
                if(res_body == '') {
                    jsonObj = {};
                }
                else {
                    jsonObj = JSON.parse(res_body);
                }
                callback(res.headers['x-m2m-rsc'], jsonObj);
            }
            catch (e) {
                console.log('[http_adn] json parse error]');
                jsonObj = {};
                jsonObj.dbg = res_body;
                callback(9999, jsonObj);
            }
        });
    });

    req.on('error', function (e) {
        console.log('problem with request: ' + e.message);
        jsonObj = {};
        jsonObj.dbg = e.message;

        callback(9999, jsonObj);
    });

    //console.log(bodyString);

    //console.log(path);

    req.write(bodyString);
    req.end();
}
