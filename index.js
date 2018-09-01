'use strict';

const {exec} = require('child_process');
const fs = require('fs');
const util = require('util');
const path = require('path');
const log4js = require('log4js');
log4js.configure({
    appenders: { swdapi: { type: 'file', filename: 'logs/swdapi.log' } },
    categories: { default: { appenders: ['swdapi'], level: 'debug' } }
});
const logger = log4js.getLogger('swdapi');

const express = require('express');
const compression = require('compression');
const opn = require('opn');
const yaml = require('js-yaml');
const widdershins = require('widdershins');
const shins = require('shins');
const mkdirp = require('mkdirp');
const glob = require("glob");

const ourVersion = require('./package.json').version;
const petstore = require('./data/static.js').petstore;
const schemaFolder = 'schema';
const docFolder = 'api_docs';
const defModule = 'global';
const defVersion = '1.0';
const schemaExt = '.yml';
const docExt = '.html';
const logo = 'source/images/logo.png';

let defName = 'default.json';
let definition = petstore;
let writeBack = false;

// nice stack traces
process.on('unhandledRejection', r => logger.error(r));

let api = require('openapi-webconverter/api.js').api;
let app = api.app;
let upload = api.upload;
app.use(compression());
app.set('view engine', 'ejs');

// extract into URSA: Undo/Redo Server API, use API-chaining
app.post('/store', upload.single('filename'), function (req, res) {
    try {
        definition = JSON.parse(req.body.source);
        if (writeBack && defName) {
            let s;
            if (defName.indexOf('.json') >= 0) {
                s = JSON.stringify(definition, null, 2);
            }
            else {
                s = yaml.safeDump(definition, {lineWidth: -1});
            }
            fs.writeFile(defName, s, 'utf8', function (err) {
            });
        }
    }
    catch (ex) {
        logger.warn(ex.message);
    }
    res.send('OK');
});

// List schemas for spec module
app.post('/swdschemas', upload.single('filename'), function (req, res) {
    try {

        logger.debug("swdschemas req.body", JSON.stringify(req.body));

        let module = req.body.module;
        listFiles(module, true, function (err, files) {
            if(err) {
                logger.warn(err.stack);
                return;
            }

            var swdschemas = [];

            files.forEach((file) => {
                let swdchema = schemaFromFileName(path.basename(file, schemaExt));
                swdschemas.push(swdchema);
            } );

            logger.info('SwdSchemas: ' + JSON.stringify(swdschemas));

            res.send(swdschemas);
        });
    }
    catch (ex) {
        logger.warn(ex.message);
        res.send(ex.message);
    }

});

// Generate API doc
app.post('/generate', upload.single('filename'), function (req, res) {
    try {

        definition = JSON.parse(req.body.schema);
        let module = req.body.module;
        let name = req.body.name;
        let version = req.body.version;
        if (name == null) {
            name = defName;
        }
        if (module == null) {
            module = defModule;
        }
        if (version == null) {
            version = defVersion;
        }

        let moduleFolder = schemaFolder + path.sep + module;
        // Prepare module directory
        mkdirp(moduleFolder, function (err) {
            if (err) {
                logger.error("Failed to create folder because: " + moduleFolder + " because : " + err.stack);
                res.send(err);
                return;
            }

            let schemaFile = moduleFolder + path.sep + nameWithVeriosn(name, version) + schemaExt;

            // Write schema file
            let s = yaml.safeDump(definition, {lineWidth: -1});
            backupFile(schemaFile);
            fs.writeFile(schemaFile, s, 'utf8', function (err) {
                if (err) {
                    logger.error('Failed to write file because: ' + err.stack);
                    res.send(err);
                    return;
                }

                logger.info('Saved schema file: ', schemaFile);

                generateApiDoc(module, name, version, schemaFile, function (err) {
                    if(err) {
                        logger.error('Failed to generate api document because: ' + err.stack);
                        res.send(err);
                    }

                });
            });

        });

        res.send('OK');
    }
    catch (ex) {
        logger.warn(ex.message);
        res.send(ex.message);
    }

});

app.get('/serve', function (req, res) {
    res.set('Content-Type', 'application/json');
    res.send(JSON.stringify(definition, null, 2));
});

const getWiddershinsOptions = function () {
    let options = {}; // defaults shown
    options.codeSamples = true;
    ////options.loadedFrom = sourceUrl;
    ////options.user_templates = './user_templates';
    options.theme = 'darkula';
    options.search = true;
    options.sample = true; // set false by --raw
    options.discovery = false;
    options.includes = [];
    options.language_tabs = [{'http': 'HTTP'}, {'javascript': 'JavaScript'}, {'javascript--nodejs': 'Node.JS'}, {'python': 'Python'}];
    options.headings = 2;
    return options;
}

const getShinsOptions = function () {
    let options = {};
    options.minify = false;
    options.customCss = false;
    options.inline = false;
    return options;
}

app.get('/markdown', function (req, res) {
    widdershins.convert(definition, getWiddershinsOptions(), function (err, str) {
        res.set('Content-Type', 'text/plain');
        res.send(err || str);
    });
});

app.get('/shins', function (req, res) {
    widdershins.convert(definition, getWiddershinsOptions(), function (err, str) {
        shins.render(str, getShinsOptions(), function (err, html) {
            res.set('Content-Type', 'text/html');
            res.send(err || html);
        });
    });
});

app.get('/', function (req, res) {
    res.sendFile(__dirname + '/index.html');
});
app.use("/", express.static(__dirname, {
    setHeaders: function (res, path) {
        res.set('X-OpenAPI-GUI', ourVersion);
    }
}));

function server(myport, argv) {
    let oag = app.listen(myport, function () {
        let host = oag.address().address;
        let port = oag.address().port;

        console.log('OpenAPI GUI server listening at http://%s:%s', host, port);
        if (argv.w || argv.write) writeBack = true;
        if (argv.l || argv.launch) {
            let path = '';
            defName = (argv.d || argv.definition);
            if (defName) {
                path = '/?url=%2fserve';
                console.log('Serving', defName);
                definition = yaml.safeLoad(fs.readFileSync(defName, 'utf8'), {json: true});
            }
            logger.info('Launching...');
            opn('http://' + (host === '::' ? 'localhost' : host) + ':' + port + path);
        }
    });
}

function generateApiDoc(module, name, version, schemaFile, callback) {

    let moduleFolder = docFolder + path.sep + module;

    // Prepare module directory
    mkdirp(moduleFolder, function (err) {

        if (err) {
            callback(err);
            return err;
        }

        let docFile = moduleFolder + path.sep + nameWithVeriosn(name, version) + docExt;
        backupFile(docFile);

        let generateCommand = 'api2html -o ' + docFile + ' -c ' + logo + ' ' + schemaFile;
        exec(generateCommand, (error, stdout, stderr) => {
            if (error) {
                callback(error);
            }

            logger.info('Generated ApiDoc: ', docFile);

            callback();
        });
    });
}

function backupFile(file) {

    if(!fs.existsSync(file)) {
        return;
    }

    let ext = path.extname(file);
    let dirname = path.dirname(file);
    let backupFolder = dirname + path.sep + 'backup';

    mkdirp(backupFolder, function (err) {

        if (err) {
            logger.error('Backup file failed: ' + err.stack);
            return;
        }

        let dateFormat = require('dateformat');
        let now = new Date();
        let timestamp = dateFormat(now, 'yyyymmddhhMMss');
        let backupFile = backupFolder + path.sep + path.basename(file, ext) + '-' + timestamp + ext;
        fs.copyFileSync(file, backupFile);
        logger.info('Backup file: ' + file + ' to ' + backupFile)
    });
}

function listFiles(module, isSchema, callback) {

    let folder = (isSchema ? schemaFolder : docFolder) + path.sep + module;
    let searchString = folder + path.sep + '*' + (isSchema ? schemaExt : docExt);

    glob(searchString, function (err, files) {
        callback(err, files);
    })
}

function nameWithVeriosn(name, version) {
    return name + '_' + version.replace('.', '-');
}

function schemaFromFileName(fileName) {

    let split = fileName.split('_');
    let schema = {};
    if(split.length > 1) {
        schema.name = split[0];
        schema.version = split[1].replace('-', '.');
    }
    logger.debug('File ' + fileName + ' Schema: ' + JSON.stringify(schema));
    return schema;
}

module.exports = {
    server: server
};

