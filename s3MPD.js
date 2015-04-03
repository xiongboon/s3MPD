/**
 * @constructor
 * @property {S3} s3 An Amazon S3 API instance
 * @property {integer} currentFile Keeps track of the current file number being downloaded
 * @property {integer} fullSize Keeps track of the full download size for the array
 * @property {array} fileSizes Array of individual file sizes
 * @property {array} fileArray Array of files to download
 * @property {string} bucket Amazon S3 bucket
 * @property {array} chunkDownloadProgress Keeps track of inidividual file/chunk download progress
 * @property {function} fileSavedFunction Function that gets called when a file is saved
 * @property {function} updateProgressBarFunction Function that gets called to update a progress bar
 * @property {integer} fileSize File size of the currently downloading file
 * @property {boolean} savingFile Designates whether or not the progress bar should show that it is saving a file
 * @property {string} objectName Keeps track of the file name of the file currently being downloaded
 * @property {integer} tries Keeps track of the number of retry attempts for a single file
 * @property {integer} range How many bytes a single chunk should be
 * @property {integer} i_max Total number of chunks to break the file into
 * @property {uint8array} tempBlob Temporary blob to hold individual chunks that get downloaded
 * @property {array} allChunks Temporary array to keep track of which chunks have already been downloaded
 * @property {array} chunkStaging Temporary array to keep track of how many chunks are currently downloading
 * @property {uint8array} fullBlob Completed blob of downloaded file
 * @property {integer} chunkSize Size of each chunk to download
 * @property {integer} chunks Number of chunks to download at the same time
 * @property {integer} currentChunk Keeps track of the current chunk being downloaded
 * @property {string} localMD5 MD5 of the current downloaded file
 * @property {integer} averageSpeed Average download speed
 * @property {integer} lastSpeed Last recorded download speed
 * @property {function} callback Callback function (should remove this later and figure out a better way to pass the callback to the setTimeout)
 * @property {boolean} gettingSize Designates whether or not the progress bar should show that it is getting the full download size
 * @property {integer} sizeDone Number of files that have successfully gotten their download size
 * @param {string} keyID Amazon IAM Key ID
 * @param {string} accessKey Amazon IAM Access Key
 * @param {string} region Amazon S3 Region
 * @param {function} callback Callback function
 */
function s3MPD(keyID, accessKey, region, callback) {
	AWS.config.update({accessKeyId: keyID, secretAccessKey: accessKey});
	AWS.config.region = region;

	this.s3 = new AWS.S3();

	this.getInitialDownloadSpeed(function(speed) {
		callback();
	});
}

/**
 * Diagnostic logging to the console and the diagnosticLogs variable
 * @param {string} msg String to log
 */
s3MPD.prototype.diagLog = function(msg) {
	var _this = this;

	console.log(msg);
	diagnosticLogs.push(msg);
}

/**
 * Downloads an array of files
 * @param {object} params Download parameters
 * @param {function} callback Callback function
 * @param {function} fileSavedFunction Function that gets called when a file is saved
 * @param {function} updateProgressBarFunction Function that gets called to update a progress bar
 * @config {array} [files] Array of files to download
 * @config {string} [bucket] Amazon S3 bucket
 */
s3MPD.prototype.downloadArray = function(params, callback, fileSavedFunction, updateProgressBarFunction) {
	var _this = this;

	_this.diagLog('Downloading Array');

	_this.currentFile = 0;
	_this.fullSize = 0;

	_this.fileSizes = new Array();

	_this.fileArray = params.files;
	_this.bucket = params.bucket;

	_this.chunkDownloadProgress = new Array();

	if (fileSavedFunction) {
		_this.fileSavedFunction = fileSavedFunction;
	} else {
		_this.fileSavedFunction = null;
	}

	if (updateProgressBarFunction) {
		_this.updateProgressBarFunction = updateProgressBarFunction;
	} else {
		_this.updateProgressBarFunction = null;
	}

	/** Internal function to start download process */
	function internal_download() {
		_this.fileSize = _this.fileSizes[_this.currentFile];

		if (_this.currentFile < _this.fileArray.length) {
			_this.does_file_exist(_this.fileArray[_this.currentFile], function(bool) {
				if (bool) {
					_this.diagLog('File Already Exists: ' + _this.fileArray[_this.currentFile]);

					_this.getLocalFileSize(_this.fileArray[_this.currentFile], function(size) {
						_this.chunkDownloadProgress[_this.currentFile] = new Array();
						_this.chunkDownloadProgress[_this.currentFile][0] = size;

						_this.getFileURL(_this.fileArray[_this.currentFile], function(fileURL) {
							if (_this.fileSavedFunction) {
								_this.fileSavedFunction(_this.currentFile, _this.fileArray[_this.currentFile], fileURL);
							}

							_this.currentFile++;

							internal_download();
						});
					});
				} else {
					_this.diagLog('Downloading File ' + (_this.currentFile + 1) + ' / ' + (_this.fileArray.length + 1));

					_this.download(_this.fileArray[_this.currentFile], function() {
						_this.saveCurrentFile(function(success) {
							if (success) {
								_this.currentFile++;

								internal_download();
							}
						});
					});
				}
			});
		} else {
			callback();
		} 
	}

	_this.getFullDownloadSize(function() {
		internal_download();
	});
}

/**
 * Checks to see if a file exists in the file system
 * @param {string} fileName File name
 * @param {function} callback Callback function
 */
s3MPD.prototype.does_file_exist = function(fileName, callback) {
	var _this = this;

	if (fs == null) {
		setTimeout(function() {
			_this.does_file_exist(filename, callback);
		},1000);
	} else {
		fs.root.getFile(fileName, {create : false}, function(fileEntry) {
			callback(true);
		}, function() {
			callback(false);
		});
	}
}

/**
 * Gets the file size of a local file
 * @param {string} fileName File name
 * @param {function} callback Callback function
 */
s3MPD.prototype.getLocalFileSize = function(fileName, callback) {
	var _this = this;

	if (fs == null) {
		setTimeout(function() {
			_this.getLocalFileSize(filename, callback);
		},1000);
	} else {
		fs.root.getFile(fileName, {create : false}, function(fileEntry) {
			fileEntry.getMetadata(function(metadata) { 
			    callback(metadata.size);
			});
		}, function() {
			callback(false);
		});
	}
}

/**
 * Gets a local file URL
 * @param {string} fileName File name
 * @param {function} callback Callback function
 */
s3MPD.prototype.getFileURL = function(fileName, callback) {
	var _this = this;

	fs.root.getFile(fileName, {create: false}, function(fileEntry) {
		var fileURL = fileEntry.toURL();

		callback(fileURL);
	}, errorHandler);
}

/**
 * Saves the currently downloaded file
 * @param {function} callback Callback function
 */
s3MPD.prototype.saveCurrentFile = function(callback) {
	var _this = this;

	_this.savingFile = true;

	_this.updateProgressBarFunction();

	fs.root.getFile(_this.objectName, {create: true}, function(fileEntry) {
		fileEntry.createWriter(function(fileWriter) {
		  	fileWriter.onwriteend = function(e) {
				_this.diagLog('File Saved: ' + _this.objectName);

				var fileURL = fileEntry.toURL();

				if (_this.fileSavedFunction) {
					_this.fileSavedFunction(_this.currentFile, _this.objectName, fileURL);
				}
			
				fileEntry = null;
				fileWriter = null;

				_this.savingFile = false;

				callback(true);
			};

			fileWriter.onerror = function(e) {
				_this.diagLog('File Save Failed: ' + _this.objectName + ' - ' + e.toString());

				_this.savingFile = false;

				callback(false);
			};

			fileWriter.write(_this.fullBlob);
		}, errorHandler);
	}, errorHandler);
}

/**
 * Downloads a single file
 * @param {string} object File name to download
 * @param {function} callback Callback function
 */
s3MPD.prototype.download = function(object, callback) {
	var _this = this;

	_this.objectName = object;
	_this.tries = 0;

	_this.chunkDownloadProgress[_this.currentFile] = new Array();

	_this.getParameters(function() {
		_this.diagLog('Starting Download...');
	
		var fileSize = _this.fileSize;
		var range = _this.chunkSize;

		if ( range >= fileSize ) {
			range = fileSize;
		}

		_this.range = range;

		var i_max = Math.ceil(fileSize / _this.range);

		_this.i_max = i_max;

		if ( _this.chunks > _this.i_max ) {
			_this.chunks = _this.i_max;
		}

		_this.tempBlob = new Uint8Array( fileSize );
		_this.allChunks = new Array();
		_this.chunkStaging = new Array();

		for (var x = 0; x < _this.i_max; x++) {
			_this.allChunks.push(x);
		}

		_this.chunkListener(callback);
	});
}

/**
 * Stages chunks to be downloaded and waits for all chunks to finish downloading
 * @param {function} callback Callback function
 */
s3MPD.prototype.chunkListener = function(callback) {
	var _this = this;

	setTimeout(function() {
		if (_this.chunkStaging.length < _this.chunks){
			var nextChunk = _this.allChunks.pop();

			if (nextChunk != undefined) {
				_this.chunkStaging.push(true);

				_this.downloadChunk(nextChunk, function (blob, y) {
					if (blob) {
						_this.tempBlob.set( new Uint8Array( blob ), y * _this.range );
						_this.chunkStaging.pop();

						_this.chunkListener(callback);
					} else {
						_this.diagLog('File Has Been Skipped');
					}
				});

				_this.chunkListener(callback);
			} else {
				if ((_this.chunkStaging.length == 0) && (_this.tempBlob != null)) {
					_this.diagLog('All Chunks Downloaded!');

					_this.fullBlob = new Blob([_this.tempBlob.buffer], {type: _this.contentType });
					_this.tempBlob = null;

					_this.getBlobMD5(function() {
						_this.remoteMD5 = _this.eTag;

						if (_this.localMD5 == _this.remoteMD5) {
							_this.diagLog(_this.objectName + ': MD5 Success');
							
							callback();
					    } else if (_this.remoteMD5.indexOf('-')) {
					    	_this.diagLog(_this.objectName + ': Not able to compare MD5 Hashes (multipart upload)');
					    	
					    	callback();
					    } else {
					    	_this.diagLog(_this.objectName + ': MD5 Failure');

					    	_this.fullBlob = null;
					    	_this.download(_this.objectName, callback);
					    }
					});
				} else {
					setTimeout(function() {
						_this.chunkListener(callback);
					}, 100, callback, _this);
				}
			}
		}
	}, 100, callback, _this);
}

/**
 * Gets download parameters based on initial download speed
 * @param {function} callback Callback function
 */
s3MPD.prototype.getParameters = function(callback) {
	var _this = this;

	_this.diagLog('Getting Download Parameters');

	var speed = _this.averageSpeed;
	var fileSize = _this.fileSize;

	if (speed == 0) {
		var maxChunkSize = 102400; //100KB
	} else {
		var maxChunkSize = Math.ceil((fileSize / Math.ceil((fileSize / speed) / 120)) * .8);
	}

	if (speed <= 512000) {
		_this.chunkSize = Math.min(maxChunkSize, 1048576);

		_this.chunks = 1;
	} else {
		switch (true) {
			case (speed < 1048576): //1MB per second
				_this.chunkSize = 5 * 1024 * 1024; //5MB

				_this.chunks = 3;

				break;	
			case (speed < 3932160): //3.75MB per second
				_this.chunkSize = 10 * 1024 * 1024; //10MB

				_this.chunks = 4;

				break;
			default: //anything over 3.75MB per second
				_this.chunkSize = 15 * 1024 * 1024; //15MB

				_this.chunks = 4;

				break;
		}
	}

	callback();
}

/**
 * Updates the average download speed
 * @param {function} callback Callback function
 */
s3MPD.prototype.updateAverageSpeed = function(callback) {
	var _this = this;

	var smoothingFactor = .005;
	var lastSpeed = _this.lastSpeed;
	var averageSpeed = _this.averageSpeed;

	_this.averageSpeed = (smoothingFactor * lastSpeed) + ((1 - smoothingFactor) * averageSpeed); //Exponential moving average algorithm

	callback();
}

/**
 * Downloads an individual chunk
 * @param {integer} i Chunk that should be downloaded
 * @param {function} callback Callback function
 */
s3MPD.prototype.downloadChunk = function(i, callback) {
	var _this = this;

	var fileSize = _this.fileSize;

	_this.chunkDownloadProgress[_this.currentFile][i] = 0; 
	_this.currentChunk = i;

	var next = (i + 1);

	if ( next >= _this.i_max) {
		var rng = 'bytes='+ (_this.range * i) + '-' +  fileSize;
	} else {
		var rng = 'bytes='+ (_this.range * i) + '-' + ((_this.range * i) + (_this.range - 1));
	}

	_this.diagLog('Downloading Chunk ' + (i+1) + "/" + _this.i_max);

	var params = {
		Bucket: _this.bucket,
		Key: _this.objectName,
		Range: rng
	};
	
	var req = _this.s3.getObject( params );
	
	req.on('error', function(msg){
		_this.tries++;

		if (_this.tries <= 5) {
			_this.diagLog('Chunk ' + i + ' failed. Attempt #' + _this.tries + '. Retrying...');

			_this.downloadChunk(i, callback);
		} else {
			_this.diagLog('Chunk ' + i + ' failed. Attempt #' + _this.tries + '. Skipping File...');

			callback(false);
		}
	});

	req.on('httpError', function(error, response) {
		_this.tries++;

		if (_this.tries <= 5) {
			_this.diagLog('Chunk ' + i + ' failed. Attempt #' + _this.tries + '. Retrying...');

			_this.downloadChunk(i, callback);
		} else {
			_this.diagLog('Chunk ' + i + ' failed. Attempt #' + _this.tries + '. Skipping File...');

			callback(false);
		}
	});

	req.on('httpDownloadProgress', function (evt) {
		_this.chunkDownloadProgress[_this.currentFile][i] = evt.loaded;
		
		_this.diagLog("Download Progress: " + _this.objectName + " | " + (i + 1) + " / " + _this.i_max +" - " +  (parseInt(evt.loaded) / parseInt(evt.total) * 100).toFixed(2) + "%");

		_this.updateProgressBarFunction();
	});

	req.on('complete', function (response) {
		if (response.error) {
			_this.diagLog('Chunk ' + i + ' failed. Retrying...');

			_this.downloadChunk(i, callback);
		} else {
			_this.diagLog('Finished Chunk ' + (i+1) + "/" + _this.i_max);

			var end = new Date();
			end = end.getTime();

			var time = ((end - start) / 1000);
			var speed = fileSize / time;

			_this.lastSpeed = speed;

			_this.updateAverageSpeed(function() {
				_this.contentType = response.data.ContentType;
				_this.eTag = response.data.ETag.substring(1, response.data.ETag.length-1);

				callback(response.data.Body, i);
			});
		}
	});

	var start = new Date();
	start = start.getTime();

	req.send();
}

/**
 * Gets the MD5 hash of the currently downloaded file
 * @param {function} callback Callback function
 */
s3MPD.prototype.getBlobMD5 = function(callback) {
	var _this = this;

	var fileReader = new FileReader();

    fileReader.onload = function(e) {
    	_this.localMD5 = SparkMD5.hashBinary(e.target.result);

    	callback();
    };

    fileReader.readAsBinaryString(_this.fullBlob);
}

/**
 * Gets the initial download speed
 * @param {function} callback Callback function
 */
s3MPD.prototype.getInitialDownloadSpeed = function(callback) {
	var _this = this;

	_this.diagLog('Getting Initial Download Speed');

	var fileSize = 1000000;
	var totalBytes = 0;

	if (_this.tries == null) {
		_this.tries = 0;
	}

	var params = {
		Bucket: 'torokiosk',
		Key: '1meg.test'
	};
	
	var req = _this.s3.getObject( params );
	
	req.on('error', function(msg){
		if (_this.tries > 5) {
			req.abort();

			req = null;

			_this.diagLog('Cannot Get Initial Download Speed');

			callback(false);
		}

		_this.tries++;

		_this.getInitialDownloadSpeed(callback);
	});

	req.on('httpDownloadProgress', function (progress, response) {
		if (progress.loaded < totalBytes) {
			var end = new Date();
			end = end.getTime();

			var time = ((end - start) / 1000);
			var speed = fileSize / time;

			req.abort();

			_this.tries = null;
			req = null;

			_this.diagLog('Initial Download Speed: ' + (speed / 1024 / 1024) + 'MB/s');

			callback(speed);
		}

		totalBytes = progress.loaded;
	});

	req.on('complete', function (response) {
		if (response.error) {
			if (_this.tries > 5) {
				req.abort();

				req = null;

				_this.diagLog('Cannot Get Initial Download Speed');

				callback(false);
			}

			_this.tries++;

			_this.getInitialDownloadSpeed(callback);
		} else {
			var end = new Date();
			end = end.getTime();

			var time = ((end - start) / 1000);
			var speed = fileSize / time;

			_this.averageSpeed = speed;
			_this.lastSpeed = speed;

			_this.diagLog('Initial Download Speed: ' + (speed / 1024 / 1024) + 'MB/s');

			callback(speed);
		}
	});

	var start = new Date();
	start = start.getTime();

	req.send();
}

/**
 * Gets the full download size for the array
 * @param {function} callback Callback function
 */
s3MPD.prototype.getFullDownloadSize = function(callback) {
	var _this = this;

	_this.callback = callback;
	_this.gettingSize = true;

	_this.diagLog('Getting Full Download Size');

	_this.sizeDone = 0;

	_this.fileArray.forEach(function(value, key) {
		_this.diagLog('Getting File Size: ' + (key + 1) + ' / ' + _this.fileArray.length);

		var params = {
			Bucket: _this.bucket,
			Key: value
		};

		_this.s3.headObject(params, function(err, data) {
			if (err) {
				_this.diagLog(err + ' ' + err.stack);
			} else {
				if (data.ContentLength == undefined) {
					var xhr = $.ajax({
						type: "HEAD",
						url: ('https://s3.amazonaws.com/torokiosk/' + value),
						success: function(msg) {
							_this.fullSize += parseInt(xhr.getResponseHeader('Content-Length'));
							_this.fileSizes[key] = parseInt(xhr.getResponseHeader('Content-Length'));

							_this.updateProgressBarFunction();

							_this.sizeDone++;
						}
					});	
				} else {
					_this.fullSize += parseInt(data.ContentLength);
					_this.fileSizes[key] = parseInt(data.ContentLength);

					_this.updateProgressBarFunction();

					_this.sizeDone++;
				}
		  	}
		});
	});

	/** Internal function to wait for full download size to finish */
	function wait_for_download_size() {
		var __this = _this;

		var doneNum = __this.fileArray.length;

		setTimeout(function() {
			if (_this.sizeDone == doneNum) {
				_this.diagLog('Finished Getting Full Download Size: ' + _this.fullSize);

				_this.gettingSize = false;

				_this.callback();
			} else {
				wait_for_download_size();
			}
		}, 100, _this);
	}

	wait_for_download_size();
}