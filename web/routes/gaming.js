'use strict';
var express = require('express');
var app = express();
var data = process.env;
var tools = require('../tools');
var dateformat = require('dateformat');
var net = require('net');
var http = require('http');
var db = require('../modules/database').get();

/* GET users listing. */
app.get('/', function (req, res) {
    let user = tools.getUser(req);
    getServers((servers) => {
        res.render('gaming/index.pug', {
            title: 'Gaming',
            servers: JSON.stringify(servers),
            config: data,
            user: user
        });
    });
});

app.get('/api/check/:provider/:address/:port', (req, res, next) => {
    let provider = req.params.provider;
    let address = req.params.address;
    let port = req.params.port;


    switch (provider) {
        case "steam":
            http.get({
                hostname: "api.steampowered.com",
                port: 80,
                path: "/ISteamApps/GetServersAtAddress/v0001?addr=" + address + ":" + port + "&format=json"
            }, (resp) => {
                let rawData = "";

                resp.resume();
                resp.on('data', (chunk) => {
                    rawData += chunk;
                });
                resp.on('error', (err) => {
                    console.log(err.message);
                    return res.send(false);
                });
                resp.on('end', () => {
                    try {
                        let parsedData = JSON.parse(rawData);
                        if (parsedData.response.servers.length > 0) return res.send(true);
                        else return res.send(false);
                    } catch (e) {
                        console.log(e.message);
                        return res.send(false);
                    }
                });
            }).on("error", (err) => {
                console.log(err.message);
                return res.send(false);
            });
            break;
        case "minecraft":
            getServerStatus({
                host: address, port
            }).then((server) => {
                return res.send(server.online);
            }).catch((server) => {
                return res.send(server.online);
            });
            break;
    }

});

app.get('/forums', function (req, res) {
    let user = tools.getUser(req);
    getThreads((err, forums) => {

        if (user && user.joined) {
            try {
                let joined = new Date(user.joined);
                user.joined = dateformat(joined, "mmm dS, yyyy h:MM TT");
            } catch (e) {
                console.log(e);
            }
        }

        res.render('gaming/forum.pug', {
            title: 'Community Forums',
            config: data,
            forums: JSON.stringify(forums),
            user: user
        });
    });
});

app.get('/forums/:subtopic', function (req, res) {
    let user = tools.getUser(req);
    getSubtopic(req.params.subtopic, (err, forums) => {

        /*if (user && user.joined) {
            try {
                let joined = new Date(user.joined);
                user.joined = dateformat(joined, "mmm dS, yyyy h:MM TT");
            } catch (e) {
                console.log(e);
            }
        }*/

        if (err) {
            res.send(err);
        } else {
            res.json(forums);
        }
    });
});

app.get('/forums/:subtopic/:thread_id', function (req, res) {
    let user = tools.getUser(req);
    if (req.params.thread_id === "new") {
        res.send('New');
    } else {
        // @ts-ignore
        getThread(req.params.thread_id, (err, forums) => {

            /*if (user && user.joined) {
                try {
                    let joined = new Date(user.joined);
                    user.joined = dateformat(joined, "mmm dS, yyyy h:MM TT");
                } catch (e) {
                    console.log(e);
                }
            }*/

            res.json(forums);
        });
    }
});

let getServers = (callback) => {
    db.query("SELECT * FROM servers", (err, rows, fields) => {
        let data = [];

        for (let i = 0; i < rows.length; i++) {
            let server = {
                game: rows[i].server,
                name: rows[i].name,
                version: rows[i].version,
                port: rows[i].port,
                host: rows[i].url,
                status: "Offline"
            };

            switch (rows[i].service) {
                case "steam":
                    server.target = "_self";
                    server.url = "steam://connect/" + rows[i].url + ":" + rows[i].port;
                    break;
                default:
                    server.target = "_blank";
                    server.url = rows[i].url + ":" + rows[i].port;
                    break;
            }
            
            data.push(server);

            if (i === rows.length - 1) {
                callback(data);
            }

        }

    });
};

let getServerStatus = (serv) => {

    return new Promise((resolve, reject) => {
		let server = {};

		// connect to the server using NET.
		let client = net.connect(serv.port, serv.host, function() {
			// Send buffer packet to grab status information.
			let buff = new Buffer([ 0xFE, 0x01 ]);
			client.write(buff);
		}).on('data', function(raw) {
			// Receive the status info from `data` packet
			if(raw != null) {
				// Split the data to read status info
				let server_info = raw.toString().split("\x00\x00\x00");

				// Determine if server is online
				if(server_info != null && server_info.length)	{
					server.online = true;
					server.version = server_info[2].replace(/\u0000/g,'');
					server.motd = server_info[3].replace(/\u0000/g,'');
					server.current_players = server_info[4].replace(/\u0000/g,'');
					server.max_players = server_info[5].replace(/\u0000/g,'');
				} else {
					server.online = false;
				}
			};
      
            // Close connection first...
			client.end();
			
			// Then return JSON
            resolve(server);
      
		}).on('error', function(e) {
            server.online = false;
            server.error = e.message;

            client.end();

			reject(server);
		});
	});
};

/**
 * @param {number} thread Thread ID
 * @param {Function} callback Callback function
 */
let getThread = (thread, callback) => {
    db.query("SELECT forum_topics.topic, forum_topics.subtopic, forum_threads.*, posts.content, posts.author_id, posts.created, posts.last_modified, posts.post_id, users.name_first, users.name_last, users.nickname, users.joined FROM forum_topics LEFT JOIN forum_threads ON forum_threads.topic_id =forum_topics.topic_id LEFT JOIN( SELECT content, thread_id as id, author_id, created, last_modified, post_id FROM forum_posts ORDER BY last_modified DESC LIMIT 1) AS posts ON posts.id = forum_threads.thread_id LEFT JOIN users ON posts.author_id = users.id WHERE forum_threads.thread_id = \"" + thread + "\" ORDER BY forum_threads.thread_id;", (err, rows) => {
        if (err) throw err;
        if (rows.length !== 0) {
            // array for merging the topics
            let data = [];

            for (let i = 0; i < rows.length; i++) {
                let author = rows[i]['nickname'] ? rows[i]['nickname'] : rows[i]['name_first'] ? rows[i]['name_first'] + " " + rows[i]['name_last'] : null;

                let timestamp;
                if (rows[i]['last_modified']) {
                    timestamp = new Date(rows[i]['last_modified']);
                    timestamp = dateformat(timestamp, "ddd, mmm dS, yyyy") + " at " + dateformat(timestamp, "h:MM TT");
                } else {
                    timestamp = "";
                }

                // Test to see if topic is already in the data array
                let test = { bool: false, index: 0 };
                for (let r = 0; r < data.length; r++) {
                    if (data[r]['topic'] === rows[i]['topic']) {
                        test = {
                            bool: true,
                            index: r
                        };
                    }
                }

                if (!test.bool) { // if not in the array, add the topic and subtopic
                    data[data.length] = {
                        'topic': rows[i]['topic'],
                        'id': rows[i]['topic_id'],
                        'subtopics': [{
                            'subtopic': rows[i]['subtopic'],
                            'thread': {
                                'title': rows[i]['title'],
                                'id': rows[i]['thread_id'],
                                'created': timestamp,
                                'author': {
                                    'id': rows[i]['author_id'],
                                    'name': author
                                },
                                'privilege': rows[i]['privilege']
                            }
                        }]
                    };
                } else { // else add the subtopic to the already created topic
                    data[test.index].subtopics.push({
                        'subtopic': rows[i]['subtopic'],
                        'id': rows[i]['thread_id'],
                        'thread': {
                            'title': rows[i]['title'],
                            'id': rows[i]['post_id'],
                            'created': timestamp,
                            'author': {
                                'id': rows[i]['author_id'],
                                'name': author
                            },
                            'privilege': rows[i]['privilege']
                        }
                    });
                }

            }

            // send back error = false and the data
            callback(false, data);
        } else {
            callback("No thread with id: '" + thread + "' was found!");
        }
    });
};

/**
 * @param {string} subtopic Thread ID
 * @param {Function} callback Callback function
 */
let getSubtopic = (subtopic, callback) => {
    db.query("SELECT forum_topics.topic, forum_topics.subtopic, forum_threads.*, posts.content, posts.author_id, posts.created, posts.last_modified, posts.post_id, users.name_first, users.name_last, users.nickname, users.joined FROM forum_topics LEFT JOIN forum_threads ON forum_threads.topic_id =forum_topics.topic_id LEFT JOIN( SELECT content, thread_id as id, author_id, created, last_modified, post_id FROM forum_posts ORDER BY last_modified DESC LIMIT 1) AS posts ON posts.id = forum_threads.thread_id LEFT JOIN users ON posts.author_id = users.id WHERE forum_topics.subtopic = \"" + subtopic + "\" ORDER BY forum_threads.thread_id;", (err, rows) => {
        if (err) throw err;
        if (rows.length !== 0) {
            // array for merging the topics
            let data = [];

            for (let i = 0; i < rows.length; i++) {
                let author = rows[i]['nickname'] ? rows[i]['nickname'] : rows[i]['name_first'] ? rows[i]['name_first'] + " " + rows[i]['name_last'] : null;

                let timestamp;
                if (rows[i]['last_modified']) {
                    timestamp = new Date(rows[i]['last_modified']);
                    timestamp = dateformat(timestamp, "ddd, mmm dS, yyyy") + " at " + dateformat(timestamp, "h:MM TT");
                } else {
                    timestamp = "";
                }

                // Test to see if topic is already in the data array
                let test = { bool: false, index: 0 };
                for (let r = 0; r < data.length; r++) {
                    if (data[r]['topic'] === rows[i]['topic']) {
                        test = {
                            bool: true,
                            index: r
                        };
                    }
                }

                if (!test.bool) { // if not in the array, add the topic and subtopic
                    data[data.length] = {
                        'topic': rows[i]['topic'],
                        'id': rows[i]['topic_id'],
                        'subtopics': [{
                            'subtopic': rows[i]['subtopic'],
                            'thread': {
                                'title': rows[i]['title'],
                                'id': rows[i]['thread_id'],
                                'created': timestamp,
                                'author': {
                                    'id': rows[i]['author_id'],
                                    'name': author
                                },
                                'privilege': rows[i]['privilege']
                            }
                        }]
                    };
                } else { // else add the subtopic to the already created topic
                    data[test.index].subtopics.push({
                        'subtopic': rows[i]['subtopic'],
                        'id': rows[i]['thread_id'],
                        'thread': {
                            'title': rows[i]['title'],
                            'id': rows[i]['post_id'],
                            'created': timestamp,
                            'author': {
                                'id': rows[i]['author_id'],
                                'name': author
                            },
                            'privilege': rows[i]['privilege']
                        }
                    });
                }

            }

            // send back error = false and the data
            callback(false, data);
        } else {
            callback("No Subtopic '" + subtopic + "' was found!");
        }
    });
};

let getThreads = (callback) => {
    // get the threads with the user attached to each one
    db.query("SELECT forum_topics.topic, forum_topics.subtopic, forum_threads.*, posts.content, posts.author_id, posts.created, posts.last_modified, posts.post_id, users.name_first, users.name_last, users.nickname, users.joined FROM forum_topics LEFT JOIN forum_threads ON forum_threads.topic_id =forum_topics.topic_id LEFT JOIN( SELECT content, thread_id as id, author_id, created, last_modified, post_id FROM forum_posts ORDER BY last_modified DESC LIMIT 1) AS posts ON posts.id = forum_threads.thread_id LEFT JOIN users ON posts.author_id = users.id ORDER BY forum_threads.thread_id;", (err, rows) => {
        if (err) throw err;
        if (rows.length !== 0) {
            // array for merging the topics
            let data = [];

            for (let i = 0; i < rows.length; i++) {
                let author = rows[i]['nickname'] ? rows[i]['nickname'] : rows[i]['name_first'] ? rows[i]['name_first'] + " " + rows[i]['name_last'] : null;

                let timestamp;
                if (rows[i]['last_modified']) {
                    timestamp = new Date(rows[i]['last_modified']);
                    timestamp = dateformat(timestamp, "ddd, mmm dS, yyyy") + " at " + dateformat(timestamp, "h:MM TT");
                } else {
                    timestamp = "";
                }

                // Test to see if topic is already in the data array
                let test = { bool: false, index: 0, isSub: false, subtopic: 0 };
                for (let r = 0; r < data.length; r++) {
                    if (data[r]['topic'] === rows[i]['topic']) {

                        test = {
                            bool: true,
                            index: r,
                            isSub: false,
                            subtopic: 0
                        };

                        for (let t = 0; t < data[r].subtopics.length; t++) {
                            console.log(rows[i]['subtopic'], data[r]['subtopics'][t].subtopic, rows[i]['subtopic'] === data[r]['subtopics'][t].subtopic);
                            if (rows[i]['subtopic'] === data[r]['subtopics'][t].subtopic) {
                                test = {
                                    bool: true,
                                    index: r,
                                    isSub: true,
                                    subtopic: t
                                };
                            }
                        }
                    }
                }
                
                if (!test.bool) { // if not in the array, add the topic and subtopic
                    data[data.length] = {
                        'topic': rows[i]['topic'],
                        'id': rows[i]['topic_id'],
                        'subtopics': [{
                            'subtopic': rows[i]['subtopic'],
                            'thread': {
                                'title': rows[i]['title'],
                                'id': rows[i]['thread_id'],
                                'created': timestamp,
                                'author': {
                                    'id': rows[i]['author_id'],
                                    'name': author
                                },
                                'privilege': rows[i]['privilege']
                            }
                        }]
                    };
                } else if (test.bool && test.isSub) {
                    data[test.index].subtopics[test.subtopic] = {
                        'subtopic': rows[i]['subtopic'],
                        'id': rows[i]['thread_id'],
                        'thread': {
                            'title': rows[i]['title'],
                            'id': rows[i]['post_id'],
                            'created': timestamp,
                            'author': {
                                'id': rows[i]['author_id'],
                                'name': author
                            },
                            'privilege': rows[i]['privilege']
                        }
                    };
                } else { // else add the subtopic to the already created topic
                    data[test.index].subtopics.push({
                        'subtopic': rows[i]['subtopic'],
                        'id': rows[i]['thread_id'],
                        'thread': {
                            'title': rows[i]['title'],
                            'id': rows[i]['post_id'],
                            'created': timestamp,
                            'author': {
                                'id': rows[i]['author_id'],
                                'name': author
                            },
                            'privilege': rows[i]['privilege']
                        }
                    });
                }

            }

            // send back error = false and the data
            callback(false, data);
        } else {
            // if no rows, send no threads were found.
            rows.error = 'No threads were found!';
            return callback(true, rows); // BTW to other developers, this doesn't do anything past here... most likely will cause errors.
        }
    });
};

module.exports = app;