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

const fs = require('fs');
const mqtt = require('mqtt');
const {nanoid} = require("nanoid");

const net = require('net');
const udp = require('dgram');

const mavlink = require('./mavlibrary/mavlink.js');

mqtt_connect(conf.cse.host);

let control_drone_info_topic = '/Mobius/' + conf.gcs + '/Control_Drone_Info';

global.drone_info_file_update_flag = 0;

function mqtt_connect(serverip) {
    if (!mobius_mqtt_client) {
        let connectOptions;
        if (conf.usesecure === 'disable') {
            connectOptions = {
                host: serverip,
                port: conf.cse.mqttport,
                protocol: "mqtt",
                keepalive: 10,
                clientId: 'mavUTM_' + nanoid(15),
                protocolId: "MQTT",
                protocolVersion: 4,
                clean: true,
                reconnectPeriod: 2 * 1000,
                connectTimeout: 30 * 1000,
                queueQoSZero: false,
                rejectUnauthorized: false
            };
        }
        else {
            connectOptions = {
                host: serverip,
                port: conf.cse.mqttport,
                protocol: "mqtts",
                keepalive: 10,
                clientId: 'mavUTM_' + nanoid(15),
                protocolId: "MQTT",
                protocolVersion: 4,
                clean: true,
                reconnectPeriod: 2 * 1000,
                connectTimeout: 30 * 1000,
                queueQoSZero: false,
                key: fs.readFileSync("./server-key.pem"),
                cert: fs.readFileSync("./server-crt.pem"),
                rejectUnauthorized: false
            };
        }

        mobius_mqtt_client = mqtt.connect(connectOptions);

        mobius_mqtt_client.on('connect', () => {
            if (conf.running_type === 'local') {
                mobius_mqtt_client.subscribe(control_drone_info_topic);
                for (let idx in conf.drone) {
                    if (conf.drone.hasOwnProperty(idx)) {
                        let noti_topic = '/Mobius/' + conf.drone[idx].gcs + '/Drone_Data/' + conf.drone[idx].name + '/#';
                        mobius_mqtt_client.subscribe(noti_topic, () => {
                            console.log('[mobius_mqtt_client] noti_topic is subscribed: ' + noti_topic);

                            if (conf.commLink === 'udp') {
                                let arr_topic = noti_topic.split('/');
                                arr_topic.pop();
                                noti_topic = arr_topic.join('/');
                                createUdpCommLink(conf.drone[idx].system_id, 10000 + parseInt(conf.drone[idx].system_id, 10), noti_topic);
                            }
                            else if (conf.commLink === 'tcp') {
                                createTcpCommLink(conf.drone[idx].system_id, 9000 + parseInt(conf.drone[idx].system_id, 10), noti_topic);
                            }
                        });
                    }
                }
            }
            else if (conf.running_type === 'global') {
                retrieve_drone();
            }
            else {
                console.log('[mobius_mqtt_client.on] conf.running_type is incorrect');
            }
        });

        mobius_mqtt_client.on('message', (topic, message) => {
            if (topic.includes('/Drone_Data/')) {
                send_to_gcs_from_drone(topic, message);
            }
            else if (topic === control_drone_info_topic) {
                fs.writeFileSync(drone_info_file, JSON.stringify(JSON.parse(message.toString()), null, 4), 'utf8');
                conf.drone = JSON.parse(fs.readFileSync(drone_info_file, 'utf8'));
                drone_info_file_update_flag = 1;

                for (let idx in conf.drone) {
                    if (conf.drone.hasOwnProperty(idx)) {
                        let noti_topic = '/Mobius/' + conf.drone[idx].gcs + '/Drone_Data/' + conf.drone[idx].name + '/#';
                        mobius_mqtt_client.subscribe(noti_topic, () => {
                            console.log('[mobius_mqtt_client] noti_topic is subscribed: ' + noti_topic);
                        });
                    }
                }
            }
            else if (topic.includes('/oneM2M/req/')) {
                let jsonObj = JSON.parse(message.toString());

                if (!jsonObj['m2m:rqp']) {
                    jsonObj['m2m:rqp'] = jsonObj;
                }

                onem2m_mqtt_noti_action(topic.split('/'), jsonObj);
            }
        });

        mobius_mqtt_client.on('error', (err) => {
            console.log(err.message);
        });
    }
}

function parse_sgn(rqi, pc, callback) {
    let path_arr;
    if (pc.sgn) {
        let nmtype = pc['sgn'] ? 'short' : 'long';
        let sgnObj = {};
        let cinObj = {};
        sgnObj = pc['sgn'] ? pc['sgn'] : pc['singleNotification'];

        if (nmtype === 'long') {
            console.log('oneM2M spec. define only short name for resource')
        }
        else { // 'short'
            if (sgnObj.sur) {
                if (sgnObj.sur.charAt(0) !== '/') {
                    sgnObj.sur = '/' + sgnObj.sur;
                }
                path_arr = sgnObj.sur.split('/');
            }

            if (sgnObj.nev) {
                if (sgnObj.nev.rep) {
                    if (sgnObj.nev.rep['m2m:cin']) {
                        sgnObj.nev.rep.cin = sgnObj.nev.rep['m2m:cin'];
                        delete sgnObj.nev.rep['m2m:cin'];
                    }

                    if (sgnObj.nev.rep.cin) {
                        cinObj = sgnObj.nev.rep.cin;
                    }
                    else {
                        console.log('[mqtt_noti_action] m2m:cin is none');
                        cinObj = null;
                    }
                }
                else {
                    console.log('[mqtt_noti_action] rep tag of m2m:sgn.nev is none. m2m:notification format mismatch with oneM2M spec.');
                    cinObj = null;
                }
            }
            else if (sgnObj.sud) {
                console.log('[mqtt_noti_action] received notification of verification');
                cinObj = {};
                cinObj.sud = sgnObj.sud;
            }
            else if (sgnObj.vrq) {
                console.log('[mqtt_noti_action] received notification of verification');
                cinObj = {};
                cinObj.vrq = sgnObj.vrq;
            }
            else {
                console.log('[mqtt_noti_action] nev tag of m2m:sgn is none. m2m:notification format mismatch with oneM2M spec.');
                cinObj = null;
            }
        }
    }
    else {
        console.log('[mqtt_noti_action] m2m:sgn tag is none. m2m:notification format mismatch with oneM2M spec.');
        console.log(pc);
    }

    callback(path_arr, cinObj, rqi);
}

function response_mqtt(rsp_topic, rsc, to, fr, rqi, inpc, bodytype) {
    let rsp_message = {};
    rsp_message['m2m:rsp'] = {};
    rsp_message['m2m:rsp'].rsc = rsc;
    rsp_message['m2m:rsp'].to = to;
    rsp_message['m2m:rsp'].fr = fr;
    rsp_message['m2m:rsp'].rqi = rqi;
    rsp_message['m2m:rsp'].pc = inpc;

    if (bodytype === 'xml') {
    }
    else if (bodytype === 'cbor') {
    }
    else { // 'json'
        mobius_mqtt_client.publish(rsp_topic, JSON.stringify(rsp_message['m2m:rsp']));
    }
}

function onem2m_mqtt_noti_action(topic_arr, jsonObj) {
    if (jsonObj) {
        var bodytype = 'json';
        if (topic_arr[5]) {
            bodytype = topic_arr[5];
        }

        var op = (!jsonObj['m2m:rqp']['op']) ? '' : jsonObj['m2m:rqp']['op'];
        var to = (!jsonObj['m2m:rqp']['to']) ? '' : jsonObj['m2m:rqp']['to'];
        var fr = (!jsonObj['m2m:rqp']['fr']) ? '' : jsonObj['m2m:rqp']['fr'];
        var rqi = (!jsonObj['m2m:rqp']['rqi']) ? '' : jsonObj['m2m:rqp']['rqi'];
        var pc = {};
        pc = (!jsonObj['m2m:rqp']['pc']) ? {} : jsonObj['m2m:rqp']['pc'];

        if (pc['m2m:sgn']) {
            pc.sgn = {};
            pc.sgn = pc['m2m:sgn'];
            delete pc['m2m:sgn'];
        }

        parse_sgn(rqi, pc, (path_arr, cinObj, rqi) => {
            if (cinObj) {
                let resp_topic;
                if (cinObj.sud || cinObj.vrq) {
                    resp_topic = '/oneM2M/resp/' + topic_arr[3] + '/' + topic_arr[4] + '/' + topic_arr[5];
                    response_mqtt(resp_topic, 2001, '', conf.aei, rqi, '', topic_arr[5]);
                }
                else {
                    if ('check_sub' === path_arr[path_arr.length - 1]) {
                        console.log('mqtt ' + bodytype + ' notification <----');

                        for (let idx in conf.drone) {
                            if (conf.drone.hasOwnProperty(idx)) {
                                let noti_topic = '/Mobius/' + conf.drone[idx].gcs + '/Drone_Data/' + conf.drone[idx].name + '/#';
                                mobius_mqtt_client.unsubscribe(noti_topic, () => {
                                    console.log('[mobius_mqtt_client] noti_topic is unsubscribed: ' + noti_topic);
                                });
                            }
                        }

                        resp_topic = '/oneM2M/resp/' + topic_arr[3] + '/' + topic_arr[4] + '/' + topic_arr[5];
                        response_mqtt(resp_topic, 2001, '', conf.aei, rqi, '', topic_arr[5]);

                        console.log('mqtt response - 2001 ---->');

                        conf.drone = [];
                        conf.drone = JSON.parse(JSON.stringify(cinObj.con)).drone;
                        for (let idx in conf.drone) {
                            if (conf.drone.hasOwnProperty(idx)) {
                                let noti_topic = '/Mobius/' + conf.drone[idx].gcs + '/Drone_Data/' + conf.drone[idx].name + '/#';
                                mobius_mqtt_client.subscribe(noti_topic, () => {
                                    console.log('[mobius_mqtt_client] noti_topic is subscribed: ' + noti_topic);
                                });
                            }
                        }
                    }
                }
            }
        });
    }
    else {
        console.log('[mqtt_noti_action] message is not noti');
    }
}

function retrieve_drone() {
    rtvct('/Mobius/UTM/gMavUTM/la', conf.aei, 0, (rsc, res_body, count) => {
        if (rsc === 2000) {
            conf.drone = [];
            conf.drone = JSON.parse(JSON.stringify(res_body[Object.keys(res_body)[0]].con)).drone;
            for (let idx in conf.drone) {
                if (conf.drone.hasOwnProperty(idx)) {
                    let noti_topic = '/Mobius/' + conf.gcs + '/Drone_Data/' + conf.drone[idx].name + '/#';
                    mobius_mqtt_client.subscribe(noti_topic, () => {
                        console.log('[mobius_mqtt_client] noti_topic is subscribed: ' + noti_topic);
                    });
                }
            }

            delsub('/Mobius/UTM/gMavUTM/check_sub', 0, (rsc, res_body, count) => {
                crtsub('/Mobius/UTM/gMavUTM', conf.aei, 'check_sub', 'mqtt://' + conf.cse.host + '/' + conf.aei + '?ct=json', 0, function () {
                    let noti_topic = '/oneM2M/req/+/' + conf.aei + '/json';
                    mobius_mqtt_client.subscribe(noti_topic, () => {
                        console.log('[mobius_mqtt_client] noti_topic is subscribed: ' + noti_topic);
                    });
                });
            });
        }
        else {
            console.log('[retrieve_drone] x-m2m-rsc : ' + rsc + ' <----' + res_body);
            setTimeout(retrieve_drone, 10000);
        }
    });
}


let gcs_content = {};

let udpCommLink = {};
let tcpCommLink = {};

function createUdpCommLink(sys_id, port, topic) {
    if (!udpCommLink.hasOwnProperty(sys_id)) {
        let udpSocket = udp.createSocket('udp4');

        udpSocket.id = sys_id;
        udpSocket.topic = topic;

        udpCommLink[sys_id] = {};
        udpCommLink[sys_id].socket = udpSocket;
        udpCommLink[sys_id].port = port;

        udpCommLink[topic] = {};
        udpCommLink[topic].socket = udpSocket;
        udpCommLink[topic].port = port;

        console.log('UDP socket created on port ' + port + ' [' + sys_id + ']-[' + topic + ']');

        udpSocket.on('message', send_to_drone_from_gcs);
    }
}

function createTcpCommLink(sys_id, port, topic) {
    if (!tcpCommLink.hasOwnProperty(sys_id)) {
        let _server = net.createServer((socket) => {
            console.log('TCP socket connected [' + sys_id + '] - [' + topic + ']');

            socket.id = sys_id;
            socket.topic = topic;

            tcpCommLink[sys_id] = {};
            tcpCommLink[sys_id].socket = socket;
            tcpCommLink[sys_id].port = port;

            tcpCommLink[topic] = {};
            tcpCommLink[topic].socket = socket;
            tcpCommLink[topic].port = port;

            socket.on('data', send_to_drone_from_gcs);

            socket.on('end', () => {
                console.log('end');

                if (tcpCommLink.hasOwnProperty(this.id)) {
                    delete tcpCommLink[this.id];
                }

                if (tcpCommLink.hasOwnProperty(this.topic)) {
                    delete tcpCommLink[this.topic];
                }
            });

            socket.on('close', () => {
                console.log('close');

                if (tcpCommLink.hasOwnProperty(this.id)) {
                    delete tcpCommLink[this.id];
                }

                if (tcpCommLink.hasOwnProperty(this.topic)) {
                    delete tcpCommLink[this.topic];
                }
            });

            socket.on('error', (e) => {
                console.log('error ', e);

                if (tcpCommLink.hasOwnProperty(this.id)) {
                    delete tcpCommLink[this.id];
                }

                if (tcpCommLink.hasOwnProperty(this.topic)) {
                    delete tcpCommLink[this.topic];
                }
            });
        });

        if (conf.running_type === 'local') {
            _server.listen(port, () => {
                console.log('TCP Server for local GCS is listening on port ' + port);
            });
        }
        else if (conf.running_type === 'global') {
            _server.listen(port, () => {
                console.log('TCP Server for global GCS is listening on port ' + port);
            });
        }
        else {
            console.log('[server.listen] conf.running_type is incorrect');
        }
    }
}

let mavStrFromGcs = '';
let mavStrFromGcsLength = 0;
let mavVersionFromGcs = {};
let mavVersionFromGcsCheckFlag = {};

let mavStrFromDrone = {};
let mavStrFromDroneLength = {};
let mavVersion = {};
let mavVersionCheckFlag = {};

function send_to_drone_from_gcs(msg) {
    for (let idx in conf.drone) {
        if (conf.drone.hasOwnProperty(idx)) {
            if (this.id === conf.drone[idx].system_id) {
                let parent = '/Mobius/' + conf.drone[idx].gcs + '/GCS_Data/' + conf.drone[idx].name;
                mobius_mqtt_client.publish(parent, msg);
            }
        }
    }

    if (mavStrFromGcsLength > 0) {
        mavStrFromGcs = mavStrFromGcs.substring(0, mavStrFromGcsLength);
        mavStrFromGcsLength = 0;
    }

    mavStrFromGcs += msg.toString('hex').toLowerCase();

    while (mavStrFromGcs.length > 20) {
        let stx;
        let len;
        let mavLength;
        let sysid;
        let msgid;
        let mavPacket;

        if (!mavVersionFromGcsCheckFlag) {
            stx = mavStrFromGcs.substring(0, 2);
            if (stx === 'fe') {
                len = parseInt(mavStrFromGcs.substring(2, 4), 16);
                mavLength = (6 * 2) + (len * 2) + (2 * 2);
                sysid = parseInt(mavStrFromGcs.substring(6, 8), 16);
                msgid = parseInt(mavStrFromGcs.substring(10, 12), 16);

                if (msgid === 0 && len === 9) { // HEARTBEAT
                    mavVersionFromGcsCheckFlag = true;
                    mavVersionFromGcs = 'v1';
                }

                if ((mavStrFromGcs.length) >= mavLength) {
                    mavPacket = mavStrFromGcs.substring(0, mavLength);

                    mavStrFromGcs = mavStrFromGcs.substring(mavLength);
                    mavStrFromGcsLength = 0;
                }
                else {
                    break;
                }
            }
            else if (stx === 'fd') {
                len = parseInt(mavStrFromGcs.substring(2, 4), 16);
                mavLength = (10 * 2) + (len * 2) + (2 * 2);

                sysid = parseInt(mavStrFromDrone.substring(10, 12), 16);
                msgid = parseInt(mavStrFromDrone.substring(18, 20) + mavStrFromDrone.substring(16, 18) + mavStrFromDrone.substring(14, 16), 16);

                if (msgid === 0 && len === 9) { // HEARTBEAT
                    mavVersionFromGcsCheckFlag = true;
                    mavVersionFromGcs = 'v2';
                }
                if (mavStrFromGcs.length >= mavLength) {
                    mavPacket = mavStrFromGcs.substring(0, mavLength);

                    mavStrFromGcs = mavStrFromGcs.substring(mavLength);
                    mavStrFromGcsLength = 0;
                }
                else {
                    break;
                }
            }
            else {
                mavStrFromGcs = mavStrFromGcs.substring(2);
            }
        }
        else {
            stx = mavStrFromGcs.substring(0, 2);
            if (mavVersionFromGcs === 'v1' && stx === 'fe') {
                len = parseInt(mavStrFromGcs.substring(2, 4), 16);
                mavLength = (6 * 2) + (len * 2) + (2 * 2);

                if ((mavStrFromGcs.length) >= mavLength) {
                    mavPacket = mavStrFromGcs.substring(0, mavLength);
                    // console.log('v1', mavPacket);

                    setTimeout(parseMavFromGcs, 0, mavPacket);

                    mavStrFromGcs = mavStrFromGcs.substring(mavLength);
                    mavStrFromGcsLength = 0;
                }
                else {
                    break;
                }
            }
            else if (mavVersionFromGcs === 'v2' && stx === 'fd') {
                len = parseInt(mavStrFromGcs.substring(2, 4), 16);
                mavLength = (10 * 2) + (len * 2) + (2 * 2);

                if (mavStrFromGcs.length >= mavLength) {
                    mavPacket = mavStrFromGcs.substring(0, mavLength);
                    // console.log('v2', mavPacket);

                    setTimeout(parseMavFromGcs, 0, mavPacket);

                    mavStrFromGcs = mavStrFromGcs.substring(mavLength);
                    mavStrFromGcsLength = 0;
                }
                else {
                    break;
                }
            }
            else {
                mavStrFromGcs = mavStrFromGcs.substring(2);
            }
        }
    }
}

function parseMavFromGcs(mavPacket) {
    try {
        let ver = mavPacket.substring(0, 2);
        let msg_id;

        if (ver === 'fd') {
            msg_id = parseInt(mavPacket.substring(18, 20) + mavPacket.substring(16, 18) + mavPacket.substring(14, 16), 16);
        }
        else {
            msg_id = parseInt(mavPacket.substring(10, 12).toLowerCase(), 16);
        }

        if (msg_id === mavlink.MAVLINK_MSG_ID_HEARTBEAT) {
            // console.log('<--- ' + 'MAVLINK_MSG_ID_HEARTBEAT - ' + mavPacket);
        }
        else if (msg_id === mavlink.MAVLINK_MSG_ID_MISSION_ITEM) {
            // console.log('<--- ' + 'MAVLINK_MSG_ID_MISSION_ITEM - ' + mavPacket);
        }
        else if (msg_id === mavlink.MAVLINK_MSG_ID_MISSION_REQUEST) {
            // console.log('<--- ' + 'MAVLINK_MSG_ID_MISSION_REQUEST - ' + mavPacket);
        }
        else if (msg_id === mavlink.MAVLINK_MSG_ID_MISSION_REQUEST_LIST) {
            // console.log('<--- ' + 'MAVLINK_MSG_ID_MISSION_REQUEST_LIST - ' + mavPacket);
        }
        else if (msg_id === mavlink.MAVLINK_MSG_ID_MISSION_COUNT) {
            // console.log('<--- ' + 'MAVLINK_MSG_ID_MISSION_COUNT - ' + mavPacket);
        }
        else if (msg_id === mavlink.MAVLINK_MSG_ID_MISSION_ACK) {
            // console.log('<--- ' + 'MAVLINK_MSG_ID_MISSION_ACK - ' + mavPacket);
        }
        else if (msg_id === mavlink.MAVLINK_MSG_ID_MISSION_ITEM_INT) {
            // console.log('<--- ' + 'MAVLINK_MSG_ID_MISSION_ITEM_INT - ' + mavPacket);
        }
        else if (msg_id === mavlink.MAVLINK_MSG_ID_MISSION_CLEAR_ALL) {
            // console.log('<--- ' + 'MAVLINK_MSG_ID_MISSION_CLEAR_ALL - ' + mavPacket);
        }
        else if (msg_id === mavlink.MAVLINK_MSG_ID_GPS_RTCM_DATA) {
            // console.log('<--- ' + 'MAVLINK_MSG_ID_GPS_RTCM_DATA - ' + mavPacket);
        }
    }
    catch (e) {
        console.log(e.message);
    }
}

global.hb = {};
global.gpi = {};
global.rc1_max = {};
global.rc1_min = {};
global.rc1_trim = {};
global.rc2_max = {};
global.rc2_min = {};
global.rc2_trim = {};
global.rc3_max = {};
global.rc3_min = {};
global.rc3_trim = {};
global.rc4_max = {};
global.rc4_min = {};
global.rc4_trim = {};
global.ss = {};

global.resetGpiTimer = {};

global.result_mission_ack = {};
global.mission_request = {};

function resetGpiValue(sys_id) {
    gpi[sys_id].time_boot_ms = 0;
    gpi[sys_id].lat = 0;
    gpi[sys_id].lon = 0;
    gpi[sys_id].alt = 0;
    gpi[sys_id].relative_alt = 0;
    gpi[sys_id].vx = 0;
    gpi[sys_id].vy = 0;
}

function send_to_gcs_from_drone(topic, content_each) {
    let arr_topic = topic.split('/');
    arr_topic.pop();
    topic = arr_topic.join('/');
    if (conf.commLink === 'udp') {
        if (udpCommLink.hasOwnProperty(topic)) {
            udpCommLink[topic].socket.send(content_each, udpCommLink[topic].port, (error) => {
                if (error) {
                    udpCommLink[topic].socket.close();
                    console.log('udpCommLink[' + topic + '].socket is closed');
                }
            });
        }
    }
    else if (conf.commLink === 'tcp') {
        if (tcpCommLink.hasOwnProperty(topic)) {
            tcpCommLink[topic].socket.write(content_each);
        }
    }

    if (!mavStrFromDrone.hasOwnProperty(topic)) {
        mavStrFromDrone[topic] = '';
    }

    if (!mavStrFromDroneLength.hasOwnProperty(topic)) {
        mavStrFromDroneLength[topic] = 0;
    }

    if (!mavVersion.hasOwnProperty(topic)) {
        mavVersion[topic] = 'unknown';
    }

    if (!mavVersionCheckFlag.hasOwnProperty(topic)) {
        mavVersionCheckFlag[topic] = false;
    }

    if (mavStrFromDroneLength[topic] > 0) {
        mavStrFromDrone[topic] = mavStrFromDrone[topic].substring(mavStrFromDroneLength[topic]);
        mavStrFromDroneLength[topic] = 0;
    }

    mavStrFromDrone[topic] += content_each.toString('hex').toLowerCase();
    // console.log(mavStrFromDrone)

    while (mavStrFromDrone[topic].length > 20) {
        let stx;
        let len;
        let mavLength;
        let sysid;
        let msgid;
        let mavPacket;

        if (!mavVersionCheckFlag[topic]) {
            stx = mavStrFromDrone[topic].substring(0, 2);

            if (stx === 'fe') {
                len = parseInt(mavStrFromDrone[topic].substring(2, 4), 16);
                mavLength = (6 * 2) + (len * 2) + (2 * 2);
                sysid = parseInt(mavStrFromDrone[topic].substring(6, 8), 16);
                msgid = parseInt(mavStrFromDrone[topic].substring(10, 12), 16);

                if (msgid === 0 && len === 9) { // HEARTBEAT
                    mavVersionCheckFlag[topic] = true;
                    mavVersion[topic] = 'v1';
                }

                if ((mavStrFromDrone[topic].length) >= mavLength) {
                    mavPacket = mavStrFromDrone[topic].substring(0, mavLength);

                    mavStrFromDrone[topic] = mavStrFromDrone[topic].substring(mavLength);
                    mavStrFromDroneLength = 0;
                }
                else {
                    break;
                }
            }
            else if (stx === 'fd') {
                len = parseInt(mavStrFromDrone[topic].substring(2, 4), 16);
                mavLength = (10 * 2) + (len * 2) + (2 * 2);

                sysid = parseInt(mavStrFromDrone[topic].substring(10, 12), 16);
                msgid = parseInt(mavStrFromDrone[topic].substring(18, 20) + mavStrFromDrone[topic].substring(16, 18) + mavStrFromDrone[topic].substring(14, 16), 16);

                if (msgid === 0 && len === 9) { // HEARTBEAT
                    mavVersionCheckFlag[topic] = true;
                    mavVersion[topic] = 'v2';
                }
                if (mavStrFromDrone[topic].length >= mavLength) {
                    mavPacket = mavStrFromDrone[topic].substring(0, mavLength);

                    mavStrFromDrone[topic] = mavStrFromDrone[topic].substring(mavLength);
                    mavStrFromDroneLength = 0;
                }
                else {
                    break;
                }
            }
            else {
                mavStrFromDrone[topic] = mavStrFromDrone[topic].substring(2);
            }
        }
        else {
            stx = mavStrFromDrone[topic].substring(0, 2);
            if (mavVersion[topic] === 'v1' && stx === 'fe') {
                len = parseInt(mavStrFromDrone[topic].substring(2, 4), 16);
                mavLength = (6 * 2) + (len * 2) + (2 * 2);

                if ((mavStrFromDrone[topic].length) >= mavLength) {
                    mavPacket = mavStrFromDrone[topic].substring(0, mavLength);
                    // console.log('v1', mavPacket);

                    setTimeout(parseMavFromDrone, 0, mavPacket);

                    mavStrFromDrone[topic] = mavStrFromDrone[topic].substring(mavLength);
                    mavStrFromDroneLength[topic] = 0;
                }
                else {
                    break;
                }
            }
            else if (mavVersion[topic] === 'v2' && stx === 'fd') {
                len = parseInt(mavStrFromDrone[topic].substring(2, 4), 16);
                mavLength = (10 * 2) + (len * 2) + (2 * 2);

                if (mavStrFromDrone[topic].length >= mavLength) {
                    mavPacket = mavStrFromDrone[topic].substring(0, mavLength);
                    // console.log('v2', mavPacket);

                    setTimeout(parseMavFromDrone, 0, mavPacket);

                    mavStrFromDrone[topic] = mavStrFromDrone[topic].substring(mavLength);
                    mavStrFromDroneLength[topic] = 0;
                }
                else {
                    break;
                }
            }
            else {
                mavStrFromDrone[topic] = mavStrFromDrone[topic].substring(2);
            }
        }
    }
}

function parseMavFromDrone(mavPacket) {
    try {
        let ver = mavPacket.substring(0, 2);
        let msg_len = parseInt(mavPacket.substring(2, 4), 16);
        let sys_id;
        let msg_id;
        let base_offset = 12;

        if (ver === 'fd') {
            sys_id = parseInt(mavPacket.substring(10, 12).toLowerCase(), 16);
            msg_id = parseInt(mavPacket.substring(18, 20) + mavPacket.substring(16, 18) + mavPacket.substring(14, 16), 16);
            base_offset = 20;
        }
        else {
            sys_id = parseInt(mavPacket.substring(6, 8).toLowerCase(), 16);
            msg_id = parseInt(mavPacket.substring(10, 12).toLowerCase(), 16);
            base_offset = 12;
        }

        if (msg_id === mavlink.MAVLINK_MSG_ID_HEARTBEAT) { // #00 : HEARTBEAT
            let my_len = 9;
            let ar = mavPacket.split('');
            for (let i = 0; i < (my_len - msg_len); i++) {
                ar.splice(ar.length - 4, 0, '0');
                ar.splice(ar.length - 4, 0, '0');
            }
            mavPacket = ar.join('');

            let custom_mode = mavPacket.substring(base_offset, base_offset + 8).toLowerCase();
            base_offset += 8;
            let type = mavPacket.substring(base_offset, base_offset + 2).toLowerCase();
            base_offset += 2;
            let autopilot = mavPacket.substring(base_offset, base_offset + 2).toLowerCase();
            base_offset += 2;
            let base_mode = mavPacket.substring(base_offset, base_offset + 2).toLowerCase();
            base_offset += 2;
            let system_status = mavPacket.substring(base_offset, base_offset + 2).toLowerCase();
            base_offset += 2;
            let mavlink_version = mavPacket.substring(base_offset, base_offset + 2).toLowerCase();

            if (!hb.hasOwnProperty(sys_id)) {
                hb[sys_id] = {};
            }
            hb[sys_id].type = Buffer.from(type, 'hex').readUInt8(0);
            hb[sys_id].autopilot = Buffer.from(autopilot, 'hex').readUInt8(0);
            hb[sys_id].base_mode = Buffer.from(base_mode, 'hex').readUInt8(0);
            hb[sys_id].custom_mode = Buffer.from(custom_mode, 'hex').readUInt32LE(0);
            hb[sys_id].system_status = Buffer.from(system_status, 'hex').readUInt8(0);
            hb[sys_id].mavlink_version = Buffer.from(mavlink_version, 'hex').readUInt8(0);

            if (rc3_trim.hasOwnProperty(sys_id) && rc3_max.hasOwnProperty(sys_id) && rc3_min.hasOwnProperty(sys_id)) {
                if (hb[sys_id].custom_mode === 0) {
                    rc3_trim[sys_id].param_value = rc3_min[sys_id].param_value;
                }
                else {
                    rc3_trim[sys_id].param_value = (rc3_max[sys_id].param_value + rc3_min[sys_id].param_value) / 2;
                }
            }
        }
        else if (msg_id === mavlink.MAVLINK_MSG_ID_SYS_STATUS) {
            let my_len = 31;
            if (ver === 'fd') {
                my_len += 12;
            }
            let ar = mavPacket.split('');
            for (let i = 0; i < (my_len - msg_len); i++) {
                ar.splice(ar.length - 4, 0, '0');
                ar.splice(ar.length - 4, 0, '0');
            }
            mavPacket = ar.join('');

            base_offset += 28;
            let voltage_battery = mavPacket.substring(base_offset, base_offset + 8).toLowerCase();

            if (!ss.hasOwnProperty(sys_id)) {
                ss[sys_id] = {};
            }

            ss[sys_id].voltage_battery = Buffer.from(voltage_battery, 'hex').readUInt16LE(0);
        }
        else if (msg_id === mavlink.MAVLINK_MSG_ID_GLOBAL_POSITION_INT) {
            let my_len = 28;
            let ar = mavPacket.split('');
            for (let i = 0; i < (my_len - msg_len); i++) {
                ar.splice(ar.length - 4, 0, '0');
                ar.splice(ar.length - 4, 0, '0');
            }
            mavPacket = ar.join('');

            let time_boot_ms = mavPacket.substring(base_offset, base_offset + 8).toLowerCase();
            base_offset += 8;
            let lat = mavPacket.substring(base_offset, base_offset + 8).toLowerCase();
            base_offset += 8;
            let lon = mavPacket.substring(base_offset, base_offset + 8).toLowerCase();
            base_offset += 8;
            let alt = mavPacket.substring(base_offset, base_offset + 8).toLowerCase();
            base_offset += 8;
            let relative_alt = mavPacket.substring(base_offset, base_offset + 8).toLowerCase();
            base_offset += 8;
            let vx = mavPacket.substring(base_offset, base_offset + 4).toLowerCase();
            base_offset += 4;
            let vy = mavPacket.substring(base_offset, base_offset + 4).toLowerCase();
            base_offset += 4;
            let vz = mavPacket.substring(base_offset, base_offset + 4).toLowerCase();
            base_offset += 4;
            let hdg = mavPacket.substring(base_offset, base_offset + 4).toLowerCase();


            if (!gpi.hasOwnProperty(sys_id)) {
                gpi[sys_id] = {};
            }

            gpi[sys_id].time_boot_ms = Buffer.from(time_boot_ms, 'hex').readUInt32LE(0);
            gpi[sys_id].lat = Buffer.from(lat, 'hex').readInt32LE(0);
            gpi[sys_id].lon = Buffer.from(lon, 'hex').readInt32LE(0);
            gpi[sys_id].alt = Buffer.from(alt, 'hex').readInt32LE(0);
            gpi[sys_id].relative_alt = Buffer.from(relative_alt, 'hex').readInt32LE(0);
            gpi[sys_id].vx = Buffer.from(vx, 'hex').readInt16LE(0);
            gpi[sys_id].vy = Buffer.from(vy, 'hex').readInt16LE(0);
            gpi[sys_id].vz = Buffer.from(vz, 'hex').readInt16LE(0);
            gpi[sys_id].hdg = Buffer.from(hdg, 'hex').readUInt16LE(0);

            if (resetGpiTimer.hasOwnProperty(sys_id)) {
                clearTimeout(resetGpiTimer[sys_id]);
            }

            resetGpiTimer[sys_id] = setTimeout(resetGpiValue, 2000, sys_id);
        }
        else if (msg_id === mavlink.MAVLINK_MSG_ID_PARAM_VALUE) {
            let my_len = 25;
            let ar = mavPacket.split('');
            for (let i = 0; i < (my_len - msg_len); i++) {
                ar.splice(ar.length - 4, 0, '0');
                ar.splice(ar.length - 4, 0, '0');
            }
            mavPacket = ar.join('');

            let param_value = mavPacket.substring(base_offset, base_offset + 8).toLowerCase();
            base_offset += 8;
            let param_count = mavPacket.substring(base_offset, base_offset + 4).toLowerCase();
            base_offset += 4;
            let param_index = mavPacket.substring(base_offset, base_offset + 4).toLowerCase();
            base_offset += 4;
            let param_id = mavPacket.substring(base_offset, base_offset + 32).toLowerCase();
            base_offset += 32;
            let param_type = mavPacket.substring(base_offset, base_offset + 2).toLowerCase();

            param_id = Buffer.from(param_id, "hex").toString('ASCII');

            if (param_id.includes('RC1_MIN')) {
                //console.log(param_id);
                if (!rc1_min.hasOwnProperty(sys_id)) {
                    rc1_min[sys_id] = {};
                }

                rc1_min[sys_id].param_value = Buffer.from(param_value, 'hex').readFloatLE(0);
                rc1_min[sys_id].param_type = Buffer.from(param_type, 'hex').readInt8(0);
                rc1_min[sys_id].param_count = Buffer.from(param_count, 'hex').readInt16LE(0);
                rc1_min[sys_id].param_index = Buffer.from(param_index, 'hex').readUInt16LE(0);
            }
            else if (param_id.includes('RC1_MAX')) {
                //console.log(param_id);
                if (!rc1_max.hasOwnProperty(sys_id)) {
                    rc1_max[sys_id] = {};
                }

                rc1_max[sys_id].param_value = Buffer.from(param_value, 'hex').readFloatLE(0);
                rc1_max[sys_id].param_type = Buffer.from(param_type, 'hex').readInt8(0);
                rc1_max[sys_id].param_count = Buffer.from(param_count, 'hex').readInt16LE(0);
                rc1_max[sys_id].param_index = Buffer.from(param_index, 'hex').readUInt16LE(0);
            }
            else if (param_id.includes('RC1_TRIM')) {
                //console.log(param_id);
                if (!rc1_trim.hasOwnProperty(sys_id)) {
                    rc1_trim[sys_id] = {};
                }

                rc1_trim[sys_id].param_value = Buffer.from(param_value, 'hex').readFloatLE(0);
                rc1_trim[sys_id].param_type = Buffer.from(param_type, 'hex').readInt8(0);
                rc1_trim[sys_id].param_count = Buffer.from(param_count, 'hex').readInt16LE(0);
                rc1_trim[sys_id].param_index = Buffer.from(param_index, 'hex').readUInt16LE(0);
            }
            else if (param_id.includes('RC2_MIN')) {
                //console.log(param_id);
                if (!rc2_min.hasOwnProperty(sys_id)) {
                    rc2_min[sys_id] = {};
                }

                rc2_min[sys_id].param_value = Buffer.from(param_value, 'hex').readFloatLE(0);
                rc2_min[sys_id].param_type = Buffer.from(param_type, 'hex').readInt8(0);
                rc2_min[sys_id].param_count = Buffer.from(param_count, 'hex').readInt16LE(0);
                rc2_min[sys_id].param_index = Buffer.from(param_index, 'hex').readUInt16LE(0);
            }
            else if (param_id.includes('RC2_MAX')) {
                //console.log(param_id);
                if (!rc2_max.hasOwnProperty(sys_id)) {
                    rc2_max[sys_id] = {};
                }

                rc2_max[sys_id].param_value = Buffer.from(param_value, 'hex').readFloatLE(0);
                rc2_max[sys_id].param_type = Buffer.from(param_type, 'hex').readInt8(0);
                rc2_max[sys_id].param_count = Buffer.from(param_count, 'hex').readInt16LE(0);
                rc2_max[sys_id].param_index = Buffer.from(param_index, 'hex').readUInt16LE(0);
            }
            else if (param_id.includes('RC2_TRIM')) {
                //console.log(param_id);
                if (!rc2_trim.hasOwnProperty(sys_id)) {
                    rc2_trim[sys_id] = {};
                }

                rc2_trim[sys_id].param_value = Buffer.from(param_value, 'hex').readFloatLE(0);
                rc2_trim[sys_id].param_type = Buffer.from(param_type, 'hex').readInt8(0);
                rc2_trim[sys_id].param_count = Buffer.from(param_count, 'hex').readInt16LE(0);
                rc2_trim[sys_id].param_index = Buffer.from(param_index, 'hex').readUInt16LE(0);
            }
            else if (param_id.includes('RC3_MIN')) {
                //console.log(param_id);
                if (!rc3_min.hasOwnProperty(sys_id)) {
                    rc3_min[sys_id] = {};
                }

                rc3_min[sys_id].param_value = Buffer.from(param_value, 'hex').readFloatLE(0);
                rc3_min[sys_id].param_type = Buffer.from(param_type, 'hex').readInt8(0);
                rc3_min[sys_id].param_count = Buffer.from(param_count, 'hex').readInt16LE(0);
                rc3_min[sys_id].param_index = Buffer.from(param_index, 'hex').readUInt16LE(0);
            }
            else if (param_id.includes('RC3_MAX')) {
                //console.log(param_id);
                if (!rc3_max.hasOwnProperty(sys_id)) {
                    rc3_max[sys_id] = {};
                }

                rc3_max[sys_id].param_value = Buffer.from(param_value, 'hex').readFloatLE(0);
                rc3_max[sys_id].param_type = Buffer.from(param_type, 'hex').readInt8(0);
                rc3_max[sys_id].param_count = Buffer.from(param_count, 'hex').readInt16LE(0);
                rc3_max[sys_id].param_index = Buffer.from(param_index, 'hex').readUInt16LE(0);
            }
            else if (param_id.includes('RC3_TRIM')) {
                //console.log(param_id);
                if (!rc3_trim.hasOwnProperty(sys_id)) {
                    rc3_trim[sys_id] = {};
                }

                rc3_trim[sys_id].param_value = Buffer.from(param_value, 'hex').readFloatLE(0);
                rc3_trim[sys_id].param_type = Buffer.from(param_type, 'hex').readInt8(0);
                rc3_trim[sys_id].param_count = Buffer.from(param_count, 'hex').readInt16LE(0);
                rc3_trim[sys_id].param_index = Buffer.from(param_index, 'hex').readUInt16LE(0);
            }
            else if (param_id.includes('RC4_MIN')) {
                //console.log(param_id);
                if (!rc4_min.hasOwnProperty(sys_id)) {
                    rc4_min[sys_id] = {};
                }

                rc4_min[sys_id].param_value = Buffer.from(param_value, 'hex').readFloatLE(0);
                rc4_min[sys_id].param_type = Buffer.from(param_type, 'hex').readInt8(0);
                rc4_min[sys_id].param_count = Buffer.from(param_count, 'hex').readInt16LE(0);
                rc4_min[sys_id].param_index = Buffer.from(param_index, 'hex').readUInt16LE(0);
            }
            else if (param_id.includes('RC4_MAX')) {
                //console.log(param_id);
                if (!rc4_max.hasOwnProperty(sys_id)) {
                    rc4_max[sys_id] = {};
                }

                rc4_max[sys_id].param_value = Buffer.from(param_value, 'hex').readFloatLE(0);
                rc4_max[sys_id].param_type = Buffer.from(param_type, 'hex').readInt8(0);
                rc4_max[sys_id].param_count = Buffer.from(param_count, 'hex').readInt16LE(0);
                rc4_max[sys_id].param_index = Buffer.from(param_index, 'hex').readUInt16LE(0);
            }
            else if (param_id.includes('RC4_TRIM')) {
                //console.log(param_id);
                if (!rc4_trim.hasOwnProperty(sys_id)) {
                    rc4_trim[sys_id] = {};
                }

                rc4_trim[sys_id].param_value = Buffer.from(param_value, 'hex').readFloatLE(0);
                rc4_trim[sys_id].param_type = Buffer.from(param_type, 'hex').readInt8(0);
                rc4_trim[sys_id].param_count = Buffer.from(param_count, 'hex').readInt16LE(0);
                rc4_trim[sys_id].param_index = Buffer.from(param_index, 'hex').readUInt16LE(0);
            }
        }
        else if (msg_id === mavlink.MAVLINK_MSG_ID_MISSION_ITEM) {
            // console.log('---> ' + 'MAVLINK_MSG_ID_MISSION_ITEM - ' + mavPacket);
        }
        else if (msg_id === mavlink.MAVLINK_MSG_ID_MISSION_REQUEST) {
            // console.log('---> ' + 'MAVLINK_MSG_ID_MISSION_REQUEST - ' + mavPacket);
            let my_len = 4;
            if (ver === 'fd') {
                my_len += 1;
            }
            let ar = mavPacket.split('');
            for (let i = 0; i < (my_len - msg_len); i++) {
                ar.splice(ar.length - 4, 0, '0');
                ar.splice(ar.length - 4, 0, '0');
            }
            mavPacket = ar.join('');

            let mission_sequence = mavPacket.substring(base_offset, base_offset + 4).toLowerCase();
            base_offset += 4;
            let target_system = mavPacket.substring(base_offset, base_offset + 2).toLowerCase();
            base_offset += 2;
            // let target_component = mavPacket.substring(base_offset, base_offset + 2).toLowerCase();
            base_offset += 2;
            // let mission_type = mavPacket.substring(base_offset, base_offset + 2).toLowerCase();


            if (mission_request.hasOwnProperty(sys_id)) {
                let mission_result = Buffer.from(target_system, 'hex').readUInt8(0);
                mission_request[sys_id].target_system = mission_result;
                mission_result = Buffer.from(mission_sequence, 'hex').readUInt16LE(0);
                mission_request[sys_id].seq = mission_result;
            }
        }
        else if (msg_id === mavlink.MAVLINK_MSG_ID_MISSION_REQUEST_LIST) {
            // console.log('---> ' + 'MAVLINK_MSG_ID_MISSION_REQUEST_LIST - ' + mavPacket);
        }
        else if (msg_id === mavlink.MAVLINK_MSG_ID_MISSION_COUNT) { // #33 - global_position_int
            // console.log('---> ' + 'MAVLINK_MSG_ID_MISSION_COUNT - ' + mavPacket);
        }
        else if (msg_id === mavlink.MAVLINK_MSG_ID_MISSION_ACK) { // #33 - global_position_int
            // console.log('---> ' + 'MAVLINK_MSG_ID_MISSION_ACK - ' + mavPacket);
            let my_len = 3;
            if (ver === 'fd') {
                my_len += 1;
            }
            let ar = mavPacket.split('');
            for (let i = 0; i < (my_len - msg_len); i++) {
                ar.splice(ar.length - 4, 0, '0');
                ar.splice(ar.length - 4, 0, '0');
            }
            mavPacket = ar.join('');

            let target_system = mavPacket.substring(base_offset, base_offset + 2).toLowerCase();
            base_offset += 2;
            // let target_component = mavPacket.substring(base_offset,base_offset + 2).toLowerCase();
            base_offset += 2;
            let mission_result_type = mavPacket.substring(base_offset, base_offset + 2).toLowerCase();
            base_offset += 2;
            // let mission_type = mavPacket.substring(base_offset, base_offset + 2).toLowerCase();


            if (result_mission_ack.hasOwnProperty(sys_id)) {
                mission_result = Buffer.from(target_system, 'hex').readUInt8(0);
                result_mission_ack[sys_id].target_system = mission_result;
                mission_result = Buffer.from(mission_result_type, 'hex').readUInt8(0);
                result_mission_ack[sys_id].type = mission_result;
            }
        }
        else if (msg_id === mavlink.MAVLINK_MSG_ID_MISSION_ITEM_INT) {
            // console.log('---> ' + 'MAVLINK_MSG_ID_MISSION_ITEM_INT - ' + mavPacket);
        }
    }
    catch (e) {
        console.log(e.message);
    }
}

function rtvct(target, aei, count, callback) {
    http_request(aei, target, 'get', '', '', (rsc, res_body) => {
        callback(rsc, res_body, count);
    });
}

function delsub(target, count, callback) {
    http_request('Superman', target, 'delete', '', '', (rsc, res_body) => {
        console.log(count + ' - ' + target + ' - x-m2m-rsc : ' + rsc + ' <----');
        console.log(res_body);
        callback(rsc, res_body, count);
    });
}

function crtsub(parent, aei, rn, nu, count, callback) {
    let results_ss = {};
    let bodyString = '';
    results_ss['m2m:sub'] = {};
    results_ss['m2m:sub'].rn = rn;
    results_ss['m2m:sub'].enc = {net: [1, 2, 3, 4]};
    results_ss['m2m:sub'].nu = [nu];
    results_ss['m2m:sub'].nct = 2;
    //results_ss['m2m:sub'].exc = 0;

    bodyString = JSON.stringify(results_ss);
    console.log(bodyString);

    http_request(aei, parent, 'post', '23', bodyString, (rsc, res_body) => {
        console.log(count + ' - ' + parent + '/' + rn + ' - x-m2m-rsc : ' + rsc + ' <----');
        console.log(JSON.stringify(res_body));
        callback(rsc, res_body, count);
    });
}

function http_request(origin, path, method, ty, bodyString, callback) {
    let options = {
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

    if (bodyString.length > 0) {
        options.headers['Content-Length'] = bodyString.length;
    }

    if (method === 'post') {
        let a = (ty === '') ? '' : ('; ty=' + ty);
        options.headers['Content-Type'] = 'application/vnd.onem2m-res+json' + a;
    }
    else if (method === 'put') {
        options.headers['Content-Type'] = 'application/vnd.onem2m-res+json';
    }

    let http;
    if (conf.usesecure === 'enable') {
        options.ca = fs.readFileSync('ca-crt.pem');
        options.rejectUnauthorized = false;

        http = require('https');
    }
    else {
        http = require('http');
    }

    let res_body = '';
    let jsonObj = {};
    let req = http.request(options, (res) => {
        //console.log('[crtae response : ' + res.statusCode);

        //res.setEncoding('utf8');

        res.on('data', (chunk) => {
            res_body += chunk;
        });

        res.on('end', () => {
            try {
                if (res_body === '') {
                    jsonObj = {};
                }
                else {
                    jsonObj = JSON.parse(res_body);
                }
                callback(parseInt(res.headers['x-m2m-rsc']), jsonObj);
            }
            catch (e) {
                console.log('[http_adn] json parse error]');
                jsonObj = {};
                jsonObj.dbg = res_body;
                callback(9999, jsonObj);
            }
        });
    });

    req.on('error', (e) => {
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
