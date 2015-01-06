/*
* grunt-ssh-deploy
* https://github.com/dcarlson/grunt-ssh-deploy
*
* Copyright (c) 2014 Dustin Carlson
* Licensed under the MIT license.
*/

'use strict';

module.exports = function(grunt) {

	grunt.registerTask('ssh_rollback', 'Begin Rollback', function() {
		var done = this.async();
        var Connection = require('ssh2');
        var async = require('async');

        var options = grunt.config.get('environments')[this.args]['options'];
        options.current_symlink = options.current_symlink || 'current';

		var c = new Connection();
		c.on('connect', function() {
            grunt.log.ok('Connecting to ' + options.host);
		});
		c.on('ready', function() {
			grunt.log.ok('Connected');
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

            // executes a remote command via ssh
            var execRemote = function(cmd, showLog, next){
                connection.exec(cmd, function(err, stream) {
                    if (err) {
                        grunt.log.errorlns(err);
                        grunt.log.subhead('ERROR ROLLING BACK. CLOSING CONNECTION.');
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

            var execRemoteForOutput = function(cmd, callback){
                connection.exec(cmd, function(err, stream) {
                    var out = '';
                    if (err) {
                        grunt.log.errorlns(err);
                        grunt.log.subhead('ERROR ROLLING BACK. CLOSING CONNECTION.');
                    }
                    stream.on('data', function(data, extended) {

                        out += data.toString();
                    });
                    stream.on('end', function() {
                        grunt.log.debug('REMOTE: ' + cmd);
                        if(!err) {
                            callback(out);
                        }
                    });
                });
            };

            var updateSymlink = function(callback) {
                var delete_symlink = 'rm -rf ' + options.deploy_path + '/' + options.current_symlink;
                var set_symlink = 'cd ' + options.deploy_path + ' && t=`ls -t1 | sed -n 3p` && ln -s $t ' + options.current_symlink;
                var command = set_symlink;


                execRemoteForOutput(delete_symlink + ' && ls -t1 '+ options.deploy_path +'| sed -n 3p', function (prevVersion) {
                    grunt.log.ok('Updating symlink to previous version: ' + prevVersion);
                    grunt.log.debug('--- ' + command);
                    execRemote(command, options.debug, callback);
                });
            };

            var deleteRelease = function(callback) {
                var command = 't=`ls -t1 ' + options.deploy_path + '/ | sed -n 3p` && rm -rf ' + options.deploy_path + '/$t/';
                var oldVerCommand = 'ls -t1 ' + options.deploy_path + ' | sed -n 3p';
                execRemoteForOutput(oldVerCommand, function (output) {
                    grunt.log.ok('Deleting rolled-back release: ' + output);
                    grunt.log.debug('--- ' + command);
                    execRemote(command, options.debug, callback);
                });

            };

            // closing connection to remote server
            var closeConnection = function(callback) {
                connection.end();

                callback();
            };


            var saveNodeModules = function (callback) {
                var command = 'cd ' + options.deploy_path + '/'
                        + options.current_symlink + ' && mv node_modules ../';
                grunt.log.debug(command);
                execRemote(command, options.debug, callback);
            };

            var restoreNodeModules = function (callback) {
                var command = 'cd ' + options.deploy_path + '/'
                        + options.current_symlink + ' && mv ../node_modules .';

                grunt.log.debug(command);
                execRemote(command, options.debug, callback);
            };

            async.series([
                saveNodeModules,
                updateSymlink,
                restoreNodeModules,
                // deleteRelease,
                closeConnection
            ], done);
        };
    });
};