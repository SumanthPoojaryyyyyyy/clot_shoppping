"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FirestoreApi = void 0;
const clc = require("colorette");
const logger_1 = require("../logger");
const utils = require("../utils");
const validator = require("./validator");
const types = require("./api-types");
const sort = require("./api-sort");
const util = require("./util");
const prompt_1 = require("../prompt");
const api_1 = require("../api");
const error_1 = require("../error");
const apiv2_1 = require("../apiv2");
const pretty_print_1 = require("./pretty-print");
class FirestoreApi {
    constructor() {
        this.apiClient = new apiv2_1.Client({ urlPrefix: (0, api_1.firestoreOrigin)(), apiVersion: "v1" });
        this.printer = new pretty_print_1.PrettyPrint();
    }
    async deploy(options, indexes, fieldOverrides, databaseId = "(default)") {
        const spec = this.upgradeOldSpec({
            indexes,
            fieldOverrides,
        });
        this.validateSpec(spec);
        const indexesToDeploy = spec.indexes;
        const fieldOverridesToDeploy = spec.fieldOverrides;
        const existingIndexes = await this.listIndexes(options.project, databaseId);
        const existingFieldOverrides = await this.listFieldOverrides(options.project, databaseId);
        const indexesToDelete = existingIndexes.filter((index) => {
            return !indexesToDeploy.some((spec) => this.indexMatchesSpec(index, spec));
        });
        const fieldOverridesToDelete = existingFieldOverrides.filter((field) => {
            return !fieldOverridesToDeploy.some((spec) => {
                const parsedName = util.parseFieldName(field.name);
                if (parsedName.collectionGroupId !== spec.collectionGroup) {
                    return false;
                }
                if (parsedName.fieldPath !== spec.fieldPath) {
                    return false;
                }
                return true;
            });
        });
        let shouldDeleteIndexes = options.force;
        if (indexesToDelete.length > 0) {
            if (options.nonInteractive && !options.force) {
                utils.logLabeledBullet("firestore", `there are ${indexesToDelete.length} indexes defined in your project that are not present in your ` +
                    "firestore indexes file. To delete them, run this command with the --force flag.");
            }
            else if (!options.force) {
                const indexesString = indexesToDelete
                    .map((x) => this.printer.prettyIndexString(x, false))
                    .join("\n\t");
                utils.logLabeledBullet("firestore", `The following indexes are defined in your project but are not present in your firestore indexes file:\n\t${indexesString}`);
            }
            if (!shouldDeleteIndexes) {
                shouldDeleteIndexes = await (0, prompt_1.confirm)({
                    nonInteractive: options.nonInteractive,
                    force: options.force,
                    default: false,
                    message: "Would you like to delete these indexes? Selecting no will continue the rest of the deployment.",
                });
            }
        }
        for (const index of indexesToDeploy) {
            const exists = existingIndexes.some((x) => this.indexMatchesSpec(x, index));
            if (exists) {
                logger_1.logger.debug(`Skipping existing index: ${JSON.stringify(index)}`);
            }
            else {
                logger_1.logger.debug(`Creating new index: ${JSON.stringify(index)}`);
                await this.createIndex(options.project, index, databaseId);
            }
        }
        if (shouldDeleteIndexes && indexesToDelete.length > 0) {
            utils.logLabeledBullet("firestore", `Deleting ${indexesToDelete.length} indexes...`);
            for (const index of indexesToDelete) {
                await this.deleteIndex(index);
            }
        }
        let shouldDeleteFields = options.force;
        if (fieldOverridesToDelete.length > 0) {
            if (options.nonInteractive && !options.force) {
                utils.logLabeledBullet("firestore", `there are ${fieldOverridesToDelete.length} field overrides defined in your project that are not present in your ` +
                    "firestore indexes file. To delete them, run this command with the --force flag.");
            }
            else if (!options.force) {
                const indexesString = fieldOverridesToDelete
                    .map((x) => this.printer.prettyFieldString(x))
                    .join("\n\t");
                utils.logLabeledBullet("firestore", `The following field overrides are defined in your project but are not present in your firestore indexes file:\n\t${indexesString}`);
            }
            if (!shouldDeleteFields) {
                shouldDeleteFields = await (0, prompt_1.confirm)({
                    nonInteractive: options.nonInteractive,
                    force: options.force,
                    default: false,
                    message: "Would you like to delete these field overrides? Selecting no will continue the rest of the deployment.",
                });
            }
        }
        const sortedFieldOverridesToDeploy = fieldOverridesToDeploy.sort(sort.compareFieldOverride);
        for (const field of sortedFieldOverridesToDeploy) {
            const exists = existingFieldOverrides.some((x) => this.fieldMatchesSpec(x, field));
            if (exists) {
                logger_1.logger.debug(`Skipping existing field override: ${JSON.stringify(field)}`);
            }
            else {
                logger_1.logger.debug(`Updating field override: ${JSON.stringify(field)}`);
                await this.patchField(options.project, field, databaseId);
            }
        }
        if (shouldDeleteFields && fieldOverridesToDelete.length > 0) {
            utils.logLabeledBullet("firestore", `Deleting ${fieldOverridesToDelete.length} field overrides...`);
            for (const field of fieldOverridesToDelete) {
                await this.deleteField(field);
            }
        }
    }
    async listIndexes(project, databaseId = "(default)") {
        const url = `/projects/${project}/databases/${databaseId}/collectionGroups/-/indexes`;
        const res = await this.apiClient.get(url);
        const indexes = res.body.indexes;
        if (!indexes) {
            return [];
        }
        return indexes.map((index) => {
            const fields = index.fields.filter((field) => {
                return field.fieldPath !== "__name__";
            });
            return {
                name: index.name,
                state: index.state,
                queryScope: index.queryScope,
                fields,
            };
        });
    }
    async listFieldOverrides(project, databaseId = "(default)") {
        const parent = `projects/${project}/databases/${databaseId}/collectionGroups/-`;
        const url = `/${parent}/fields?filter=indexConfig.usesAncestorConfig=false OR ttlConfig:*`;
        const res = await this.apiClient.get(url);
        const fields = res.body.fields;
        if (!fields) {
            return [];
        }
        return fields.filter((field) => {
            return !field.name.includes("__default__");
        });
    }
    makeIndexSpec(indexes, fields) {
        const indexesJson = indexes.map((index) => {
            return {
                collectionGroup: util.parseIndexName(index.name).collectionGroupId,
                queryScope: index.queryScope,
                fields: index.fields,
            };
        });
        if (!fields) {
            logger_1.logger.debug("No field overrides specified, using [].");
            fields = [];
        }
        const fieldsJson = fields.map((field) => {
            const parsedName = util.parseFieldName(field.name);
            const fieldIndexes = field.indexConfig.indexes || [];
            return {
                collectionGroup: parsedName.collectionGroupId,
                fieldPath: parsedName.fieldPath,
                ttl: !!field.ttlConfig,
                indexes: fieldIndexes.map((index) => {
                    const firstField = index.fields[0];
                    return {
                        order: firstField.order,
                        arrayConfig: firstField.arrayConfig,
                        queryScope: index.queryScope,
                    };
                }),
            };
        });
        const sortedIndexes = indexesJson.sort(sort.compareSpecIndex);
        const sortedFields = fieldsJson.sort(sort.compareFieldOverride);
        return {
            indexes: sortedIndexes,
            fieldOverrides: sortedFields,
        };
    }
    validateSpec(spec) {
        validator.assertHas(spec, "indexes");
        spec.indexes.forEach((index) => {
            this.validateIndex(index);
        });
        if (spec.fieldOverrides) {
            spec.fieldOverrides.forEach((field) => {
                this.validateField(field);
            });
        }
    }
    validateIndex(index) {
        validator.assertHas(index, "collectionGroup");
        validator.assertHas(index, "queryScope");
        validator.assertEnum(index, "queryScope", Object.keys(types.QueryScope));
        validator.assertHas(index, "fields");
        index.fields.forEach((field) => {
            validator.assertHas(field, "fieldPath");
            validator.assertHasOneOf(field, ["order", "arrayConfig", "vectorConfig"]);
            if (field.order) {
                validator.assertEnum(field, "order", Object.keys(types.Order));
            }
            if (field.arrayConfig) {
                validator.assertEnum(field, "arrayConfig", Object.keys(types.ArrayConfig));
            }
            if (field.vectorConfig) {
                validator.assertType("vectorConfig.dimension", field.vectorConfig.dimension, "number");
                validator.assertHas(field.vectorConfig, "flat");
            }
        });
    }
    validateField(field) {
        validator.assertHas(field, "collectionGroup");
        validator.assertHas(field, "fieldPath");
        validator.assertHas(field, "indexes");
        if (typeof field.ttl !== "undefined") {
            validator.assertType("ttl", field.ttl, "boolean");
        }
        field.indexes.forEach((index) => {
            validator.assertHasOneOf(index, ["arrayConfig", "order"]);
            if (index.arrayConfig) {
                validator.assertEnum(index, "arrayConfig", Object.keys(types.ArrayConfig));
            }
            if (index.order) {
                validator.assertEnum(index, "order", Object.keys(types.Order));
            }
            if (index.queryScope) {
                validator.assertEnum(index, "queryScope", Object.keys(types.QueryScope));
            }
        });
    }
    async patchField(project, spec, databaseId = "(default)") {
        const url = `/projects/${project}/databases/${databaseId}/collectionGroups/${spec.collectionGroup}/fields/${spec.fieldPath}`;
        const indexes = spec.indexes.map((index) => {
            return {
                queryScope: index.queryScope,
                fields: [
                    {
                        fieldPath: spec.fieldPath,
                        arrayConfig: index.arrayConfig,
                        order: index.order,
                    },
                ],
            };
        });
        let data = {
            indexConfig: {
                indexes,
            },
        };
        if (spec.ttl) {
            data = Object.assign(data, {
                ttlConfig: {},
            });
        }
        if (typeof spec.ttl !== "undefined") {
            await this.apiClient.patch(url, data);
        }
        else {
            await this.apiClient.patch(url, data, { queryParams: { updateMask: "indexConfig" } });
        }
    }
    deleteField(field) {
        const url = field.name;
        const data = {};
        return this.apiClient.patch(`/${url}`, data);
    }
    createIndex(project, index, databaseId = "(default)") {
        const url = `/projects/${project}/databases/${databaseId}/collectionGroups/${index.collectionGroup}/indexes`;
        return this.apiClient.post(url, {
            fields: index.fields,
            queryScope: index.queryScope,
        });
    }
    deleteIndex(index) {
        const url = index.name;
        return this.apiClient.delete(`/${url}`);
    }
    indexMatchesSpec(index, spec) {
        const collection = util.parseIndexName(index.name).collectionGroupId;
        if (collection !== spec.collectionGroup) {
            return false;
        }
        if (index.queryScope !== spec.queryScope) {
            return false;
        }
        if (index.fields.length !== spec.fields.length) {
            return false;
        }
        let i = 0;
        while (i < index.fields.length) {
            const iField = index.fields[i];
            const sField = spec.fields[i];
            if (iField.fieldPath !== sField.fieldPath) {
                return false;
            }
            if (iField.order !== sField.order) {
                return false;
            }
            if (iField.arrayConfig !== sField.arrayConfig) {
                return false;
            }
            i++;
        }
        return true;
    }
    fieldMatchesSpec(field, spec) {
        const parsedName = util.parseFieldName(field.name);
        if (parsedName.collectionGroupId !== spec.collectionGroup) {
            return false;
        }
        if (parsedName.fieldPath !== spec.fieldPath) {
            return false;
        }
        if (typeof spec.ttl !== "undefined" && util.booleanXOR(!!field.ttlConfig, spec.ttl)) {
            return false;
        }
        else if (!!field.ttlConfig && typeof spec.ttl === "undefined") {
            utils.logLabeledBullet("firestore", `there are TTL field overrides for collection ${spec.collectionGroup} defined in your project that are not present in your ` +
                "firestore indexes file. The TTL policy won't be deleted since is not specified as false.");
        }
        const fieldIndexes = field.indexConfig.indexes || [];
        if (fieldIndexes.length !== spec.indexes.length) {
            return false;
        }
        const fieldModes = fieldIndexes.map((index) => {
            const firstField = index.fields[0];
            return firstField.order || firstField.arrayConfig;
        });
        const specModes = spec.indexes.map((index) => {
            return index.order || index.arrayConfig;
        });
        for (const mode of fieldModes) {
            if (!specModes.includes(mode)) {
                return false;
            }
        }
        return true;
    }
    upgradeOldSpec(spec) {
        const result = {
            indexes: [],
            fieldOverrides: spec.fieldOverrides || [],
        };
        if (!(spec.indexes && spec.indexes.length > 0)) {
            return result;
        }
        if (spec.indexes[0].collectionId) {
            utils.logBullet(clc.bold(clc.cyan("firestore:")) +
                " your indexes indexes are specified in the v1beta1 API format. " +
                "Please upgrade to the new index API format by running " +
                clc.bold("firebase firestore:indexes") +
                " again and saving the result.");
        }
        result.indexes = spec.indexes.map((index) => {
            const i = {
                collectionGroup: index.collectionGroup || index.collectionId,
                queryScope: index.queryScope || types.QueryScope.COLLECTION,
                fields: [],
            };
            if (index.fields) {
                i.fields = index.fields.map((field) => {
                    const f = {
                        fieldPath: field.fieldPath,
                    };
                    if (field.order) {
                        f.order = field.order;
                    }
                    else if (field.arrayConfig) {
                        f.arrayConfig = field.arrayConfig;
                    }
                    else if (field.vectorConfig) {
                        f.vectorConfig = field.vectorConfig;
                    }
                    else if (field.mode === types.Mode.ARRAY_CONTAINS) {
                        f.arrayConfig = types.ArrayConfig.CONTAINS;
                    }
                    else {
                        f.order = field.mode;
                    }
                    return f;
                });
            }
            return i;
        });
        return result;
    }
    async listDatabases(project) {
        const url = `/projects/${project}/databases`;
        const res = await this.apiClient.get(url);
        const databases = res.body.databases;
        if (!databases) {
            return [];
        }
        return databases;
    }
    async locations(project) {
        const url = `/projects/${project}/locations`;
        const res = await this.apiClient.get(url);
        const locations = res.body.locations;
        if (!locations) {
            return [];
        }
        return locations;
    }
    async getDatabase(project, databaseId) {
        const url = `/projects/${project}/databases/${databaseId}`;
        const res = await this.apiClient.get(url);
        const database = res.body;
        if (!database) {
            throw new error_1.FirebaseError("Not found");
        }
        return database;
    }
    async createDatabase(req) {
        const url = `/projects/${req.project}/databases`;
        const payload = {
            locationId: req.locationId,
            type: req.type,
            deleteProtectionState: req.deleteProtectionState,
            pointInTimeRecoveryEnablement: req.pointInTimeRecoveryEnablement,
            cmekConfig: req.cmekConfig,
        };
        const options = { queryParams: { databaseId: req.databaseId } };
        const res = await this.apiClient.post(url, payload, options);
        const database = res.body.response;
        if (!database) {
            throw new error_1.FirebaseError("Not found");
        }
        return database;
    }
    async updateDatabase(project, databaseId, deleteProtectionState, pointInTimeRecoveryEnablement) {
        const url = `/projects/${project}/databases/${databaseId}`;
        const payload = {
            deleteProtectionState,
            pointInTimeRecoveryEnablement,
        };
        const res = await this.apiClient.patch(url, payload);
        const database = res.body.response;
        if (!database) {
            throw new error_1.FirebaseError("Not found");
        }
        return database;
    }
    async deleteDatabase(project, databaseId) {
        const url = `/projects/${project}/databases/${databaseId}`;
        const res = await this.apiClient.delete(url);
        const database = res.body.response;
        if (!database) {
            throw new error_1.FirebaseError("Not found");
        }
        return database;
    }
    async restoreDatabase(project, databaseId, backupName, encryptionConfig) {
        const url = `/projects/${project}/databases:restore`;
        const payload = {
            databaseId,
            backup: backupName,
            encryptionConfig: encryptionConfig,
        };
        const options = { queryParams: { databaseId: databaseId } };
        const res = await this.apiClient.post(url, payload, options);
        const database = res.body.response;
        if (!database) {
            throw new error_1.FirebaseError("Not found");
        }
        return database;
    }
}
exports.FirestoreApi = FirestoreApi;
