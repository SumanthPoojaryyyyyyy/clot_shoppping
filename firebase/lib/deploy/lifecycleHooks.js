"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lifecycleHooks = void 0;
const utils = require("../utils");
const clc = require("colorette");
const childProcess = require("child_process");
const error_1 = require("../error");
const needProjectId = require("../projectUtils").needProjectId;
const logger_1 = require("../logger");
const path = require("path");
const vsCodeUtils_1 = require("../vsCodeUtils");
function runCommand(command, childOptions) {
    const escapedCommand = command.replace(/\"/g, '\\"');
    const nodeExecutable = (0, vsCodeUtils_1.isVSCodeExtension)() ? "node" : process.execPath;
    const crossEnvShellPath = (0, vsCodeUtils_1.isVSCodeExtension)()
        ? path.resolve(__dirname, "./cross-env/dist/bin/cross-env-shell.js")
        : path.resolve(require.resolve("cross-env"), "..", "bin", "cross-env-shell.js");
    const translatedCommand = '"' + nodeExecutable + '" "' + crossEnvShellPath + '" "' + escapedCommand + '"';
    return new Promise((resolve, reject) => {
        logger_1.logger.info("Running command: " + command);
        if (command.includes("=")) {
            utils.logWarning(clc.yellow(clc.bold("Warning: ")) +
                "Your command contains '=', it may result in the command not running." +
                " Please consider removing it.");
        }
        if (translatedCommand === "") {
            return resolve();
        }
        const child = childProcess.spawn(translatedCommand, [], childOptions);
        child.on("error", (err) => {
            reject(err);
        });
        child.on("exit", (code, signal) => {
            if (signal) {
                reject(new Error("Command terminated with signal " + signal));
            }
            else if (code !== 0) {
                reject(new Error("Command terminated with non-zero exit code " + code));
            }
            else {
                resolve();
            }
        });
    });
}
function getChildEnvironment(target, overallOptions, config) {
    var _a;
    const projectId = needProjectId(overallOptions);
    const projectDir = overallOptions.projectRoot;
    let resourceDir;
    switch (target) {
        case "hosting":
            resourceDir = overallOptions.config.path((_a = config.public) !== null && _a !== void 0 ? _a : config.source);
            break;
        case "functions":
            resourceDir = overallOptions.config.path(config.source);
            break;
        default:
            resourceDir = overallOptions.config.path(overallOptions.config.projectDir);
    }
    return Object.assign({}, process.env, {
        GCLOUD_PROJECT: projectId,
        PROJECT_DIR: projectDir,
        RESOURCE_DIR: resourceDir,
    });
}
function runTargetCommands(target, hook, overallOptions, config) {
    let commands = config[hook];
    if (!commands) {
        return Promise.resolve();
    }
    if (typeof commands === "string") {
        commands = [commands];
    }
    const childOptions = {
        cwd: overallOptions.config.projectDir,
        env: getChildEnvironment(target, overallOptions, config),
        shell: true,
        stdio: [0, 1, 2],
    };
    const runAllCommands = commands.reduce((soFar, command) => {
        return soFar.then(() => runCommand(command, childOptions));
    }, Promise.resolve());
    let logIdentifier = target;
    if (config.target) {
        logIdentifier += `[${config.target}]`;
    }
    return runAllCommands
        .then(() => {
        utils.logSuccess(clc.green(clc.bold(logIdentifier + ":")) +
            " Finished running " +
            clc.bold(hook) +
            " script.");
    })
        .catch((err) => {
        throw new error_1.FirebaseError(logIdentifier + " " + hook + " error: " + err.message);
    });
}
function getReleventConfigs(target, options) {
    let targetConfigs = options.config.get(target);
    if (!targetConfigs) {
        return [];
    }
    if (!Array.isArray(targetConfigs)) {
        targetConfigs = [targetConfigs];
    }
    if (!options.only) {
        return targetConfigs;
    }
    let onlyTargets = options.only.split(",");
    if (onlyTargets.includes(target)) {
        return targetConfigs;
    }
    onlyTargets = onlyTargets
        .filter((individualOnly) => {
        return individualOnly.startsWith(`${target}:`);
    })
        .map((individualOnly) => {
        return individualOnly.replace(`${target}:`, "");
    });
    if (target === "functions") {
        let onlyConfigs = [];
        const matched = onlyTargets.reduce((matched, target) => (Object.assign(Object.assign({}, matched), { [target]: false })), {});
        for (const config of targetConfigs) {
            if (!config.codebase) {
                onlyConfigs.push(config);
            }
            else {
                const found = onlyTargets.find((individualOnly) => config.codebase === individualOnly.split(":")[0]);
                if (found) {
                    onlyConfigs.push(config);
                    matched[found] = true;
                }
            }
        }
        if (!Object.values(matched).every((matched) => matched)) {
            onlyConfigs = targetConfigs;
        }
        return onlyConfigs;
    }
    else {
        return targetConfigs.filter((config) => {
            return !config.target || onlyTargets.includes(config.target);
        });
    }
}
function lifecycleHooks(target, hook) {
    return function (context, options) {
        return getReleventConfigs(target, options).reduce((previousCommands, individualConfig) => {
            return previousCommands.then(() => {
                return runTargetCommands(target, hook, options, individualConfig);
            });
        }, Promise.resolve());
    };
}
exports.lifecycleHooks = lifecycleHooks;
