'use strict';

const pathToSwaggerUi = 'swagger-ui-dist';
const swaggerFile = 'swagger.yaml';
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
const schemaExt = '.yaml';
const docExt = '.html';
const logo = 'source/images/logo.png';

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
                let swdchema = {};
                swdchema.name = path.basename(file, schemaExt);
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

// List api docs for spec module
app.post('/swdapidocs', upload.single('filename'), function (req, res) {
    try {

        logger.debug("swdapidocs req.body", JSON.stringify(req.body));

        let module = req.body.module;
        listFiles(module, false, function (err, files) {
            if(err) {
                logger.warn(err.stack);
                return;
            }

            var apidocs = [];

            files.forEach((file) => {
                let apidoc = {};
                apidoc.name = path.basename(file, docExt);
                apidocs.push(apidoc);
            } );

            logger.info('SwdApiDocs: ' + JSON.stringify(apidocs));

            res.send(apidocs);
        });
    }
    catch (ex) {
        logger.warn(ex.message);
        res.send(ex.message);
    }

});

// View schema
app.post('/swdschema', upload.single('filename'), function (req, res) {
    try {

        let swdschema = JSON.parse(req.body.swdschema);
        logger.debug("swdschema request: ", JSON.stringify(swdschema));

        let schemaFile = genSwdFilePath(swdschema, true);
        logger.info("view schema file path: " + schemaFile);

        fs.copyFileSync(schemaFile, schemaFolder + path.sep + swaggerFile);

        res.send(pathToSwaggerUi);

    }
    catch (ex) {
        logger.warn(ex.message);
        res.send(ex.message);
    }

});

// View doc
app.post('/swdapidoc', upload.single('filename'), function (req, res) {
    try {

        let swdschema = JSON.parse(req.body.swdschema);
        logger.debug("swdapidoc request: ", JSON.stringify(swdschema));

        let docFile = genSwdFilePath(swdschema, false);
        logger.info("view apidoc file path: " + docFile);

        res.send(docFile);

    }
    catch (ex) {
        logger.warn(ex.message);
        res.send(ex.message);
    }

});

function genModuleFolder(swdschema, isSchema) {
    let moduleFolder = (isSchema ? schemaFolder : docFolder) + path.sep + swdschema.module;
    logger.debug('genModuleFolder: ' + moduleFolder);
    return moduleFolder;
}

function genSwdFilePath(swdschema, isSchema) {
    let swdFilePath = genModuleFolder(swdschema, isSchema) + path.sep + swdschema.name + (isSchema ? schemaExt : docExt);
    logger.debug('genSwdFilePath: ' + swdFilePath);
    return swdFilePath;
}

// Generate API doc
app.post('/generate', upload.single('filename'), function (req, res) {
    try {

        logger.debug('generate swdschema: ' + JSON.stringify(req.body.swdschema));

        definition = JSON.parse(req.body.schema);
        let swdschema = JSON.parse(req.body.swdschema);

        let moduleFolder = genModuleFolder(swdschema, true);
        // Prepare module directory
        mkdirp(moduleFolder, function (err) {
            if (err) {
                logger.error("Failed to create folder because: " + moduleFolder + " because : " + err.stack);
                res.send(err);
                return;
            }

            let schemaFile = genSwdFilePath(swdschema, true);

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

                generateApiDoc(swdschema, schemaFile, function (err) {
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
            let defName = (argv.d || argv.definition);
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

function generateApiDoc(swdschema, schemaFile, callback) {

    let moduleFolder = genModuleFolder(swdschema, false);

    // Prepare module directory
    mkdirp(moduleFolder, function (err) {

        if (err) {
            callback(err);
            return err;
        }

        let docFile = genSwdFilePath(swdschema, false);
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

module.exports = {
    server: server
};

