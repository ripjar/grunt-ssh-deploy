/*
* grunt-ssh-deploy
* https://github.com/dcarlson/grunt-ssh-deploy
*
* Copyright (c) 2014 Dustin Carlson
* Licensed under the MIT license.
*/

'use strict';

/* @throw Error: If privateKey or password field is not found */
var getScpOptions = function(options) {
    var scpOptions = {
        port: options.port,
        host: options.host,
        username: options.username
    };

    if(options.privateKey)
        scpOptions.privateKey = options.privateKey;
    else
        scpOptions.password = options.password;

    if(!(scpOptions.privateKey || scpOptions.password)) throw new Error('Password or private key required.');

    return scpOptions;
};

module.exports = function(grunt) {

    grunt.registerTask('ssh_deploy', 'Begin Deployment', function() {
        var done = this.async();
        var Connection = require('ssh2');
        var client = require('scp2');
        var moment = require('moment');
        var timestamp = moment().format('YYYYMMDDHHmm');

        var async = require('async');
        var extend = require('extend');

        var defaults = {
            current_symlink: 'current',
            port: 22
        };

        var options = extend({}, defaults, grunt.config.get('environments').options,
            grunt.config.get('environments')[this.args]['options']);

        var versionLabel = options.versionLabel;
        var keep = options.keep;

        // scp defaults
        client.defaults(getScpOptions(options));

        var c = new Connection();
        c.on('connect', function() {
            grunt.log.subhead('Connecting :: ' + options.host);
        });
        c.on('ready', function() {
            grunt.log.subhead('Connected :: ' + options.host);
            // execution of tasks
            execCommands(options,c);
        });
        c.on('error', function(err) {
            grunt.log.subhead("Error :: " + options.host);
            grunt.log.errorlns(err);
            if (err) {throw err;}
        });
        c.on('close', function(had_error) {
            grunt.log.subhead("Closed :: " + options.host);

            return true;
        });
        c.connect(options);

        var execCommands = function(options, connection){
            var childProcessExec = require('child_process').exec;

            var execLocal = function(cmd, next) {
                var nextFun = next;
                childProcessExec(cmd, function(err, stdout, stderr){
                    grunt.log.debug(cmd);
                    grunt.log.debug('stdout: ' + stdout);
                    grunt.log.debug('stderr: ' + stderr);
                    if (err !== null) {
                        grunt.log.errorlns('exec error: ' + err);
                        grunt.log.subhead('Error deploying. Closing connection.');

                        deleteRelease(closeConnection);
                    } else {
                        next();
                    }
                });
            };

            // executes a remote command via ssh
            var execRemote = function(cmd, showLog, next){
                connection.exec(cmd, function(err, stream) {
                    if (err) {
                        grunt.log.errorlns(err);
                        grunt.log.subhead('ERROR DEPLOYING. CLOSING CONNECTION AND DELETING RELEASE.');

                        deleteRelease(closeConnection);
                    }
                    stream.on('data', function(data, extended) {
                        grunt.log.debug((extended === 'stderr' ? 'STDERR: ' : 'STDOUT: ') + data);
                    });
                    stream.on('end', function() {
                        grunt.log.debug('REMOTE: ' + cmd);
                        if(!err) {
                            next();
                        }
                    });
                });
            };



            var onBeforeDeploy = function(callback){
                if (typeof options.before_deploy == "undefined" || !options.before_deploy) {
                    callback();
                } else {
                    var command = options.before_deploy;
                    grunt.log.subhead("--------------- RUNNING PRE-DEPLOY COMMANDS");
                    if (command instanceof Array) {
                        async.eachSeries(command, function (command, callback) {
                            grunt.log.subhead('--- ' + command);
                            execRemote(command, options.debug, callback);
                        }, callback);
                    } else {
                        grunt.log.subhead('--- ' + command);;
                        execRemote(command, options.debug, callback);
                    }
                }
            };

            var createReleases = function(callback) {
                var command = 'cd ' + options.deploy_path + ' && mkdir -p ' + versionLabel;
                grunt.log.subhead('--------------- CREATING NEW RELEASE');
                grunt.log.subhead('--- ' + command);
                execRemote(command, options.debug, callback);
            };

            var scpBuild = function(callback) {
                grunt.log.subhead('--------------- UPLOADING NEW BUILD');
                grunt.log.debug('SCP FROM LOCAL: ' + options.local_path
                    + '\n TO REMOTE: ' + options.deploy_path + '/' + versionLabel + '/');

                client.scp(options.local_path, {
                    path: options.deploy_path + '/' + versionLabel + '/'
                }, function (err) {
                    if (err) {
                        grunt.log.errorlns(err);
                    } else {
                        grunt.log.subhead('--- DONE UPLOADING');
                        callback();
                    }
                });
            };

            var updateSymlink = function(callback) {
                var delete_symlink = 'rm -rf ' + options.deploy_path + '/' + options.current_symlink;
                var set_symlink = 'cd ' + options.deploy_path + ' && ln -s ' + versionLabel + ' ' + options.current_symlink;
                var command = delete_symlink + ' && ' + set_symlink;
                grunt.log.subhead('--------------- UPDATING SYM LINK');
                grunt.log.subhead('--- ' + command);
                execRemote(command, options.debug, callback);
            };

            var deleteRelease = function(callback) {
                var command = 'rm -rf ' + options.deploy_path + '/' + versionLabel + '/';
                grunt.log.subhead('--------------- DELETING RELEASE');
                grunt.log.subhead('--- ' + command);
                execRemote(command, options.debug, callback);
            };

            var deleteOldest = function (callback) {
                var command = 'if [ $(ls -t1 | wc -l) -gt "3" ]; then t=`ls -t1 ' + options.deploy_path + '/releases/ | tail -n 1`; rm -rf ' + options.deploy_path + '/releases/$t/; fi';
                grunt.log.subhead('--------------- DELETING OLDEST RELEASE');
                grunt.log.subhead('--- ' + command);
                execRemote(command, options.debug, callback);
            };

            var onAfterDeploy = function(callback){
                if (typeof options.after_deploy == "undefined" || !options.after_deploy) {
                    callback();
                } else {
                    var command = options.after_deploy;
                    grunt.log.subhead("--------------- RUNNING POST-DEPLOY COMMANDS");
                    if (command instanceof Array) {
                        async.eachSeries(command, function (command, callback) {
                            grunt.log.subhead('--- ' + command);;
                            execRemote(command, options.debug, callback);
                        }, callback);
                    } else {
                        grunt.log.subhead('--- ' + command);;
                        execRemote(command, options.debug, callback);
                    }
                }
            };

            // closing connection to remote server
            var closeConnection = function(callback) {
                connection.end();

                callback();
            };

            async.series([
                onBeforeDeploy,
                createReleases,
                scpBuild,
                updateSymlink,
                onAfterDeploy,
                deleteOldest,
                closeConnection
            ], function () {
                done();
            });
        };
    });
};