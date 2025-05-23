"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFrameworksBuildTarget = exports.validateLocales = exports.frameworksCallToAction = exports.conjoinOptions = exports.relativeRequire = exports.findDependency = exports.getNodeModuleBin = exports.getNpmRoot = exports.simpleProxy = exports.proxyResponse = exports.warnIfCustomBuildScript = exports.readJSON = exports.isUrl = void 0;
const fs_extra_1 = require("fs-extra");
const path_1 = require("path");
const promises_1 = require("fs/promises");
const http_1 = require("http");
const cross_spawn_1 = require("cross-spawn");
const clc = require("colorette");
const semver_1 = require("semver");
const logger_1 = require("../logger");
const error_1 = require("../error");
const fsutils_1 = require("../fsutils");
const url_1 = require("url");
const constants_1 = require("./constants");
const { dynamicImport } = require(true && "../dynamicImport");
const NPM_ROOT_TIMEOUT_MILLIES = 5000;
const NPM_ROOT_MEMO = new Map();
function isUrl(url) {
    return /^https?:\/\//.test(url);
}
exports.isUrl = isUrl;
function readJSON(file, options) {
    return (0, fs_extra_1.readJSON)(file, options);
}
exports.readJSON = readJSON;
async function warnIfCustomBuildScript(dir, framework, defaultBuildScripts) {
    var _a;
    const packageJsonBuffer = await (0, promises_1.readFile)((0, path_1.join)(dir, "package.json"));
    const packageJson = JSON.parse(packageJsonBuffer.toString());
    const buildScript = (_a = packageJson.scripts) === null || _a === void 0 ? void 0 : _a.build;
    if (buildScript && !defaultBuildScripts.includes(buildScript)) {
        console.warn(`\nWARNING: Your package.json contains a custom build that is being ignored. Only the ${framework} default build script (e.g, "${defaultBuildScripts[0]}") is respected. If you have a more advanced build process you should build a custom integration https://firebase.google.com/docs/hosting/express\n`);
    }
}
exports.warnIfCustomBuildScript = warnIfCustomBuildScript;
function proxyResponse(req, res, next) {
    const proxiedRes = new http_1.ServerResponse(req);
    const buffer = [];
    proxiedRes.write = new Proxy(proxiedRes.write.bind(proxiedRes), {
        apply: (target, thisArg, args) => {
            target.call(thisArg, ...args);
            buffer.push(["write", args]);
        },
    });
    proxiedRes.setHeader = new Proxy(proxiedRes.setHeader.bind(proxiedRes), {
        apply: (target, thisArg, args) => {
            target.call(thisArg, ...args);
            buffer.push(["setHeader", args]);
        },
    });
    proxiedRes.removeHeader = new Proxy(proxiedRes.removeHeader.bind(proxiedRes), {
        apply: (target, thisArg, args) => {
            target.call(thisArg, ...args);
            buffer.push(["removeHeader", args]);
        },
    });
    proxiedRes.writeHead = new Proxy(proxiedRes.writeHead.bind(proxiedRes), {
        apply: (target, thisArg, args) => {
            target.call(thisArg, ...args);
            buffer.push(["writeHead", args]);
        },
    });
    proxiedRes.end = new Proxy(proxiedRes.end.bind(proxiedRes), {
        apply: (target, thisArg, args) => {
            target.call(thisArg, ...args);
            if (proxiedRes.statusCode === 404) {
                next();
            }
            else {
                for (const [fn, args] of buffer) {
                    res[fn](...args);
                }
                res.end(...args);
                buffer.length = 0;
            }
        },
    });
    return proxiedRes;
}
exports.proxyResponse = proxyResponse;
function simpleProxy(hostOrRequestHandler) {
    const agent = new http_1.Agent({ keepAlive: true });
    const firebaseDefaultsJSON = process.env.__FIREBASE_DEFAULTS__;
    const authTokenSyncURL = firebaseDefaultsJSON && JSON.parse(firebaseDefaultsJSON)._authTokenSyncURL;
    return async (originalReq, originalRes, next) => {
        const { method, headers, url: path } = originalReq;
        if (!method || !path) {
            originalRes.end();
            return;
        }
        if (path === authTokenSyncURL) {
            return next();
        }
        if (typeof hostOrRequestHandler === "string") {
            const { hostname, port, protocol, username, password } = new URL(hostOrRequestHandler);
            const host = `${hostname}:${port}`;
            const auth = username || password ? `${username}:${password}` : undefined;
            const opts = {
                agent,
                auth,
                protocol,
                hostname,
                port,
                path,
                method,
                headers: Object.assign(Object.assign({}, headers), { host, "X-Forwarded-Host": headers.host }),
            };
            const req = (0, http_1.request)(opts, (response) => {
                const { statusCode, statusMessage, headers } = response;
                if (statusCode === 404) {
                    next();
                }
                else {
                    originalRes.writeHead(statusCode, statusMessage, headers);
                    response.pipe(originalRes);
                }
            });
            originalReq.pipe(req);
            req.on("error", (err) => {
                logger_1.logger.debug("Error encountered while proxying request:", method, path, err);
                originalRes.end();
            });
        }
        else {
            const proxiedRes = proxyResponse(originalReq, originalRes, () => {
                void hostOrRequestHandler(originalReq, originalRes, next);
            });
            await hostOrRequestHandler(originalReq, proxiedRes, next);
        }
    };
}
exports.simpleProxy = simpleProxy;
function scanDependencyTree(searchingFor, dependencies = {}) {
    for (const [name, dependency] of Object.entries(dependencies)) {
        if (name === searchingFor)
            return dependency;
        const result = scanDependencyTree(searchingFor, dependency.dependencies);
        if (result)
            return result;
    }
    return;
}
function getNpmRoot(cwd) {
    var _a;
    let npmRoot = NPM_ROOT_MEMO.get(cwd);
    if (npmRoot)
        return npmRoot;
    npmRoot = (_a = (0, cross_spawn_1.sync)("npm", ["root"], {
        cwd,
        timeout: NPM_ROOT_TIMEOUT_MILLIES,
    })
        .stdout) === null || _a === void 0 ? void 0 : _a.toString().trim();
    NPM_ROOT_MEMO.set(cwd, npmRoot);
    return npmRoot;
}
exports.getNpmRoot = getNpmRoot;
function getNodeModuleBin(name, cwd) {
    const npmRoot = getNpmRoot(cwd);
    if (!npmRoot) {
        throw new error_1.FirebaseError(`Error finding ${name} executable: failed to spawn 'npm'`);
    }
    const path = (0, path_1.join)(npmRoot, ".bin", name);
    if (!(0, fsutils_1.fileExistsSync)(path)) {
        throw new error_1.FirebaseError(`Could not find the ${name} executable.`);
    }
    return path;
}
exports.getNodeModuleBin = getNodeModuleBin;
const DEFAULT_FIND_DEP_OPTIONS = {
    cwd: process.cwd(),
    omitDev: true,
};
function findDependency(name, options = {}) {
    const { cwd: dir, depth, omitDev } = Object.assign(Object.assign({}, DEFAULT_FIND_DEP_OPTIONS), options);
    const cwd = getNpmRoot(dir);
    if (!cwd)
        return;
    const env = Object.assign({}, process.env);
    delete env.NODE_ENV;
    const result = (0, cross_spawn_1.sync)("npm", [
        "list",
        name,
        "--json=true",
        ...(omitDev ? ["--omit", "dev"] : []),
        ...(depth === undefined ? [] : ["--depth", depth.toString(10)]),
    ], { cwd, env, timeout: constants_1.NPM_COMMAND_TIMEOUT_MILLIES });
    if (!result.stdout)
        return;
    const json = JSON.parse(result.stdout.toString());
    return scanDependencyTree(name, json.dependencies);
}
exports.findDependency = findDependency;
async function relativeRequire(dir, mod) {
    try {
        const requireFunc = typeof __webpack_require__ === "function" ? __non_webpack_require__ : require;
        const path = requireFunc.resolve(mod, { paths: [dir] });
        let packageJson;
        let isEsm = (0, path_1.extname)(path) === ".mjs";
        if (!isEsm) {
            packageJson = await readJSON((0, path_1.join)((0, path_1.dirname)(path), "package.json")).catch(() => undefined);
            isEsm = (packageJson === null || packageJson === void 0 ? void 0 : packageJson.type) === "module";
        }
        if (isEsm) {
            if ((0, path_1.extname)(path) === ".cjs" && (packageJson === null || packageJson === void 0 ? void 0 : packageJson.main)) {
                return dynamicImport((0, path_1.join)((0, path_1.dirname)(path), packageJson.main));
            }
            return dynamicImport((0, url_1.pathToFileURL)(path).toString());
        }
        else {
            return requireFunc(path);
        }
    }
    catch (e) {
        const path = (0, path_1.relative)(process.cwd(), dir);
        console.error(`Could not load dependency ${mod} in ${path.startsWith("..") ? path : `./${path}`}, have you run \`npm install\`?`);
        throw e;
    }
}
exports.relativeRequire = relativeRequire;
function conjoinOptions(_opts, conjunction = "and", separator = ",") {
    if (!_opts.length)
        return "";
    const opts = _opts.map((it) => it.toString().trim());
    if (opts.length === 1)
        return opts[0];
    if (opts.length === 2)
        return `${opts[0]} ${conjunction} ${opts[1]}`;
    const lastElement = opts.slice(-1)[0];
    const allButLast = opts.slice(0, -1);
    return `${allButLast.join(`${separator} `)}${separator} ${conjunction} ${lastElement}`;
}
exports.conjoinOptions = conjoinOptions;
function frameworksCallToAction(message, docsUrl = constants_1.DEFAULT_DOCS_URL, prefix = "", framework, version, supportedRange, vite = false) {
    return `${prefix}${message}${framework && supportedRange && (!version || !(0, semver_1.satisfies)(version, supportedRange))
        ? clc.yellow(`\n${prefix}The integration is known to work with ${vite ? "Vite" : framework} version ${clc.italic(conjoinOptions(supportedRange.split("||")))}. You may encounter errors.`)
        : ``}

${prefix}${clc.bold("Documentation:")} ${docsUrl}
${prefix}${clc.bold("File a bug:")} ${constants_1.FILE_BUG_URL}
${prefix}${clc.bold("Submit a feature request:")} ${constants_1.FEATURE_REQUEST_URL}

${prefix}We'd love to learn from you. Express your interest in helping us shape the future of Firebase Hosting: ${constants_1.MAILING_LIST_URL}`;
}
exports.frameworksCallToAction = frameworksCallToAction;
function validateLocales(locales = []) {
    const invalidLocales = locales.filter((locale) => !constants_1.VALID_LOCALE_FORMATS.some((format) => locale.match(format)));
    if (invalidLocales.length) {
        throw new error_1.FirebaseError(`Invalid i18n locales (${invalidLocales.join(", ")}) for Firebase. See our docs for more information https://firebase.google.com/docs/hosting/i18n-rewrites#country-and-language-codes`);
    }
}
exports.validateLocales = validateLocales;
function getFrameworksBuildTarget(purpose, validOptions) {
    const frameworksBuild = process.env.FIREBASE_FRAMEWORKS_BUILD_TARGET;
    if (frameworksBuild) {
        if (!validOptions.includes(frameworksBuild)) {
            throw new error_1.FirebaseError(`Invalid value for FIREBASE_FRAMEWORKS_BUILD_TARGET environment variable: ${frameworksBuild}. Valid values are: ${validOptions.join(", ")}`);
        }
        return frameworksBuild;
    }
    else if (["test", "deploy"].includes(purpose)) {
        return "production";
    }
    switch (process.env.NODE_ENV) {
        case undefined:
        case "development":
            return "development";
        case "production":
        case "test":
            return "production";
        default:
            throw new error_1.FirebaseError(`We cannot infer your build target from a non-standard NODE_ENV. Please set the FIREBASE_FRAMEWORKS_BUILD_TARGET environment variable. Valid values are: ${validOptions.join(", ")}`);
    }
}
exports.getFrameworksBuildTarget = getFrameworksBuildTarget;
