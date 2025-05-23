"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initAction = exports.command = void 0;
const clc = require("colorette");
const os = require("os");
const path = require("path");
const command_1 = require("../command");
const config_1 = require("../config");
const auth_1 = require("../auth");
const init_1 = require("../init");
const logger_1 = require("../logger");
const prompt_1 = require("../prompt");
const requireAuth_1 = require("../requireAuth");
const fsutils = require("../fsutils");
const utils = require("../utils");
const experiments_1 = require("../experiments");
const templates_1 = require("../templates");
const homeDir = os.homedir();
const BANNER_TEXT = (0, templates_1.readTemplateSync)("banner.txt");
const GITIGNORE_TEMPLATE = (0, templates_1.readTemplateSync)("_gitignore");
function isOutside(from, to) {
    return !!/^\.\./.exec(path.relative(from, to));
}
let choices = [
    {
        value: "dataconnect",
        name: "Data Connect: Set up a Firebase Data Connect service",
        checked: false,
    },
    {
        value: "firestore",
        name: "Firestore: Configure security rules and indexes files for Firestore",
        checked: false,
    },
    {
        value: "functions",
        name: "Functions: Configure a Cloud Functions directory and its files",
        checked: false,
    },
    {
        value: "apphosting",
        name: "App Hosting: Configure an apphosting.yaml file for App Hosting",
        checked: false,
        hidden: false,
    },
    {
        value: "hosting",
        name: "Hosting: Configure files for Firebase Hosting and (optionally) set up GitHub Action deploys",
        checked: false,
    },
    {
        value: "storage",
        name: "Storage: Configure a security rules file for Cloud Storage",
        checked: false,
    },
    {
        value: "emulators",
        name: "Emulators: Set up local emulators for Firebase products",
        checked: false,
    },
    {
        value: "remoteconfig",
        name: "Remote Config: Configure a template file for Remote Config",
        checked: false,
    },
    {
        value: "extensions",
        name: "Extensions: Set up an empty Extensions manifest",
        checked: false,
    },
    {
        value: "database",
        name: "Realtime Database: Configure a security rules file for Realtime Database and (optionally) provision default instance",
        checked: false,
    },
    {
        value: "hosting:github",
        name: "Hosting: Set up GitHub Action deploys",
        checked: false,
        hidden: true,
    },
    {
        value: "dataconnect:sdk",
        name: "Data Connect: Set up a generated SDK for your Firebase Data Connect service",
        checked: false,
        hidden: true,
    },
];
if ((0, experiments_1.isEnabled)("genkit")) {
    choices = [
        ...choices.slice(0, 2),
        {
            value: "genkit",
            name: "Genkit: Setup a new Genkit project with Firebase",
            checked: false,
        },
        ...choices.slice(2),
    ];
}
const featureNames = choices.map((choice) => choice.value);
const HELP = `Interactively configure the current directory as a Firebase project or initialize new features in an already configured Firebase project directory.

This command will create or update 'firebase.json' and '.firebaserc' configuration files in the current directory.

To initialize a specific Firebase feature, run 'firebase init [feature]'. Valid features are:
${[...featureNames]
    .sort()
    .map((n) => `\n  - ${n}`)
    .join("")}`;
exports.command = new command_1.Command("init [feature]")
    .description("interactively configure the current directory as a Firebase project directory")
    .help(HELP)
    .before(requireAuth_1.requireAuth)
    .action(initAction);
function initAction(feature, options) {
    if (feature && !featureNames.includes(feature)) {
        return utils.reject(clc.bold(feature) +
            " is not a supported feature; must be one of " +
            featureNames.join(", ") +
            ".");
    }
    const cwd = options.cwd || process.cwd();
    const warnings = [];
    let warningText = "";
    if (isOutside(homeDir, cwd)) {
        warnings.push("You are currently outside your home directory");
    }
    if (cwd === homeDir) {
        warnings.push("You are initializing your home directory as a Firebase project directory");
    }
    const existingConfig = config_1.Config.load(options, true);
    if (existingConfig) {
        warnings.push("You are initializing within an existing Firebase project directory");
    }
    const config = existingConfig !== null ? existingConfig : new config_1.Config({}, { projectDir: cwd, cwd: cwd });
    if (warnings.length) {
        warningText =
            "\nBefore we get started, keep in mind:\n\n  " +
                clc.yellow(clc.bold("* ")) +
                warnings.join("\n  " + clc.yellow(clc.bold("* "))) +
                "\n";
    }
    logger_1.logger.info(clc.yellow(clc.bold(BANNER_TEXT)) +
        "\nYou're about to initialize a Firebase project in this directory:\n\n  " +
        clc.bold(config.projectDir) +
        "\n" +
        warningText);
    const setup = {
        config: config.src,
        rcfile: config.readProjectFile(".firebaserc", {
            json: true,
            fallback: {},
        }),
    };
    let next;
    if (process.platform === "win32") {
        next = (0, prompt_1.promptOnce)({
            type: "confirm",
            message: "Are you ready to proceed?",
        });
    }
    else {
        next = Promise.resolve(true);
    }
    return next
        .then((proceed) => {
        if (!proceed) {
            return utils.reject("Aborted by user.", { exit: 1 });
        }
        if (feature) {
            setup.featureArg = true;
            setup.features = [feature];
            return undefined;
        }
        return (0, prompt_1.prompt)(setup, [
            {
                type: "checkbox",
                name: "features",
                message: "Which Firebase features do you want to set up for this directory? " +
                    "Press Space to select features, then Enter to confirm your choices.",
                choices: choices.filter((c) => !c.hidden),
            },
        ]);
    })
        .then(() => {
        var _a;
        if (!setup.features || ((_a = setup.features) === null || _a === void 0 ? void 0 : _a.length) === 0) {
            return utils.reject("Must select at least one feature. Use " +
                clc.bold(clc.underline("SPACEBAR")) +
                " to select features, or specify a feature by running " +
                clc.bold("firebase init [feature_name]"));
        }
        setup.features.unshift("project");
        const allAccounts = (0, auth_1.getAllAccounts)();
        if (allAccounts.length > 1) {
            setup.features.unshift("account");
        }
        if (setup.features.includes("hosting") && setup.features.includes("hosting:github")) {
            setup.features = setup.features.filter((f) => f !== "hosting:github");
        }
        return (0, init_1.init)(setup, config, options);
    })
        .then(() => {
        logger_1.logger.info();
        utils.logBullet("Writing configuration info to " + clc.bold("firebase.json") + "...");
        config.writeProjectFile("firebase.json", setup.config);
        utils.logBullet("Writing project information to " + clc.bold(".firebaserc") + "...");
        config.writeProjectFile(".firebaserc", setup.rcfile);
        if (!fsutils.fileExistsSync(config.path(".gitignore"))) {
            utils.logBullet("Writing gitignore file to " + clc.bold(".gitignore") + "...");
            config.writeProjectFile(".gitignore", GITIGNORE_TEMPLATE);
        }
        logger_1.logger.info();
        utils.logSuccess("Firebase initialization complete!");
    });
}
exports.initAction = initAction;
