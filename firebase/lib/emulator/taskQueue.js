"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskQueue = exports.TaskStatus = exports.Queue = void 0;
const abort_controller_1 = require("abort-controller");
const emulatorLogger_1 = require("./emulatorLogger");
const types_1 = require("./types");
const node_fetch_1 = require("node-fetch");
class Node {
    constructor(data) {
        this.data = data;
        this.next = null;
        this.prev = null;
    }
}
class Queue {
    constructor(capacity = 10000) {
        this.nodeMap = {};
        this.count = 0;
        this.first = null;
        this.last = null;
        this.capacity = capacity;
    }
    enqueue(id, item) {
        if (this.count >= this.capacity) {
            throw new Error("Queue has reached capacity");
        }
        const newNode = new Node(item);
        if (this.nodeMap[id] !== undefined) {
            throw new Error("Queue IDs must be unique");
        }
        this.nodeMap[id] = newNode;
        if (!this.first) {
            this.first = newNode;
        }
        if (this.last) {
            this.last.next = newNode;
        }
        newNode.prev = this.last;
        this.last = newNode;
        this.count++;
    }
    peek() {
        if (this.first) {
            return this.first.data;
        }
        else {
            throw new Error("Trying to peek into an empty queue");
        }
    }
    dequeue() {
        if (this.first) {
            const currentFirst = this.first;
            this.first = this.first.next;
            if (this.last === currentFirst) {
                this.last = null;
            }
            this.count--;
            return currentFirst.data;
        }
        else {
            throw new Error("Trying to dequeue from an empty queue");
        }
    }
    remove(id) {
        if (this.nodeMap[id] === undefined) {
            throw new Error("Trying to remove a task that doesn't exist");
        }
        const toRemove = this.nodeMap[id];
        if (toRemove.next === null && toRemove.prev === null) {
            this.first = null;
            this.last = null;
        }
        else if (toRemove.next === null) {
            this.last = toRemove.prev;
            toRemove.prev.next = null;
        }
        else if (toRemove.prev === null) {
            this.first = toRemove.next;
            toRemove.next.prev = null;
        }
        else {
            const prev = toRemove.prev;
            const next = toRemove.next;
            prev.next = next;
            next.prev = prev;
        }
        delete this.nodeMap[id];
        this.count--;
    }
    getAll() {
        const all = [];
        let curr = this.first;
        while (curr) {
            all.push(curr.data);
            curr = curr.next;
        }
        return all;
    }
    isEmpty() {
        return this.first === null;
    }
    size() {
        return this.count;
    }
}
exports.Queue = Queue;
var TaskStatus;
(function (TaskStatus) {
    TaskStatus[TaskStatus["NOT_STARTED"] = 0] = "NOT_STARTED";
    TaskStatus[TaskStatus["RUNNING"] = 1] = "RUNNING";
    TaskStatus[TaskStatus["RETRY"] = 2] = "RETRY";
    TaskStatus[TaskStatus["FAILED"] = 3] = "FAILED";
    TaskStatus[TaskStatus["FINISHED"] = 4] = "FINISHED";
})(TaskStatus = exports.TaskStatus || (exports.TaskStatus = {}));
class TaskQueue {
    constructor(key, config) {
        this.key = key;
        this.config = config;
        this.queue = new Queue();
        this.logger = emulatorLogger_1.EmulatorLogger.forEmulator(types_1.Emulators.TASKS);
        this.tokens = 0;
        this.addedTimes = [];
        this.completedTimes = [];
        this.failedTimes = [];
        this.maxTokens = Math.max(this.config.rateLimits.maxDispatchesPerSecond, 1.1);
        this.lastTokenUpdate = Date.now();
        this.queuedIds = new Set();
        this.dispatches = new Array(this.config.rateLimits.maxConcurrentDispatches).fill(null);
        this.openDispatches = Array.from(this.dispatches.keys());
    }
    dispatchTasks() {
        while (!this.queue.isEmpty() && this.openDispatches.length > 0 && this.tokens >= 1) {
            const dispatchLocation = this.openDispatches.pop();
            if (dispatchLocation !== undefined) {
                const dispatch = this.queue.dequeue();
                dispatch.metadata.lastRunTime = null;
                dispatch.metadata.currentAttempt = 1;
                dispatch.metadata.status = TaskStatus.NOT_STARTED;
                dispatch.metadata.startTime = Date.now();
                this.dispatches[dispatchLocation] = dispatch;
                this.tokens--;
            }
        }
    }
    setDispatch(dispatches) {
        this.dispatches = dispatches;
        const open = [];
        for (let i = 0; i < this.dispatches.length; i++) {
            if (dispatches[i] === null) {
                open.push(i);
            }
        }
        this.openDispatches = open;
    }
    getDispatch() {
        return this.dispatches;
    }
    processDispatch() {
        var _a;
        for (let i = 0; i < this.dispatches.length; i++) {
            if (this.dispatches[i] !== null) {
                switch ((_a = this.dispatches[i]) === null || _a === void 0 ? void 0 : _a.metadata.status) {
                    case TaskStatus.FAILED:
                        this.dispatches[i] = null;
                        this.openDispatches.push(i);
                        this.completedTimes.push(Date.now());
                        this.failedTimes.push(Date.now());
                        break;
                    case TaskStatus.NOT_STARTED:
                        void this.runTask(i);
                        break;
                    case TaskStatus.RETRY:
                        this.handleRetry(i);
                        break;
                    case TaskStatus.FINISHED:
                        this.dispatches[i] = null;
                        this.openDispatches.push(i);
                        this.completedTimes.push(Date.now());
                        break;
                }
            }
        }
    }
    async runTask(dispatchIndex) {
        if (this.dispatches[dispatchIndex] === null) {
            throw new Error("Trying to dispatch a nonexistent task");
        }
        const emulatedTask = this.dispatches[dispatchIndex];
        if (emulatedTask.metadata.lastRunTime !== null &&
            Date.now() - emulatedTask.metadata.lastRunTime < emulatedTask.metadata.currentBackoff * 1000) {
            return;
        }
        emulatedTask.metadata.status = TaskStatus.RUNNING;
        try {
            const headers = Object.assign({ "Content-Type": "application/json", "X-CloudTasks-QueueName": this.key, "X-CloudTasks-TaskName": emulatedTask.task.name.split("/").pop(), "X-CloudTasks-TaskRetryCount": `${emulatedTask.metadata.currentAttempt - 1}`, "X-CloudTasks-TaskExecutionCount": `${emulatedTask.metadata.executionCount}`, "X-CloudTasks-TaskETA": `${emulatedTask.task.scheduleTime || Date.now()}` }, emulatedTask.task.httpRequest.headers);
            if (emulatedTask.metadata.previousResponse) {
                headers["X-CloudTasks-TaskPreviousResponse"] = `${emulatedTask.metadata.previousResponse}`;
            }
            const controller = new abort_controller_1.default();
            const signal = controller.signal;
            const request = (0, node_fetch_1.default)(emulatedTask.task.httpRequest.url, {
                method: "POST",
                headers: headers,
                body: JSON.stringify(emulatedTask.task.httpRequest.body),
                signal: signal,
            });
            const dispatchDeadline = emulatedTask.task.dispatchDeadline;
            const dispatchDeadlineSeconds = dispatchDeadline
                ? parseInt(dispatchDeadline.substring(0, dispatchDeadline.length - 1))
                : 60;
            const abortId = setTimeout(() => {
                controller.abort();
            }, dispatchDeadlineSeconds * 1000);
            const response = await request;
            clearTimeout(abortId);
            if (response.ok) {
                emulatedTask.metadata.status = TaskStatus.FINISHED;
                return;
            }
            else {
                if (!(response.status >= 500 && response.status <= 599)) {
                    emulatedTask.metadata.executionCount++;
                }
                emulatedTask.metadata.previousResponse = response.status;
                emulatedTask.metadata.status = TaskStatus.RETRY;
                emulatedTask.metadata.lastRunTime = Date.now();
            }
        }
        catch (e) {
            this.logger.logLabeled("WARN", `${e}`);
            emulatedTask.metadata.status = TaskStatus.RETRY;
            emulatedTask.metadata.lastRunTime = Date.now();
        }
    }
    handleRetry(dispatchIndex) {
        if (this.dispatches[dispatchIndex] === null) {
            throw new Error("Trying to retry a nonexistent task");
        }
        const { metadata } = this.dispatches[dispatchIndex];
        const { retryConfig } = this.config;
        if (this.shouldStopRetrying(metadata, retryConfig)) {
            metadata.status = TaskStatus.FAILED;
            return;
        }
        this.updateMetadata(metadata, retryConfig);
        metadata.status = TaskStatus.NOT_STARTED;
    }
    shouldStopRetrying(metadata, retryOptions) {
        if (metadata.currentAttempt > retryOptions.maxAttempts) {
            if (retryOptions.maxRetrySeconds === null || retryOptions.maxRetrySeconds === 0) {
                return true;
            }
            if (Date.now() - metadata.startTime > retryOptions.maxRetrySeconds * 1000) {
                return true;
            }
        }
        return false;
    }
    updateMetadata(metadata, retryOptions) {
        const timeMultplier = Math.pow(2, Math.min(metadata.currentAttempt - 1, retryOptions.maxDoublings)) +
            Math.max(0, metadata.currentAttempt - retryOptions.maxDoublings - 1) *
                Math.pow(2, retryOptions.maxDoublings);
        metadata.currentBackoff = Math.min(retryOptions.maxBackoffSeconds, timeMultplier * retryOptions.minBackoffSeconds);
        metadata.currentAttempt++;
    }
    isActive() {
        return !this.queue.isEmpty() || this.dispatches.some((e) => e !== null);
    }
    refillTokens() {
        const tokensToAdd = ((Date.now() - this.lastTokenUpdate) / 1000) * this.config.rateLimits.maxDispatchesPerSecond;
        this.addTokens(tokensToAdd);
        this.lastTokenUpdate = Date.now();
    }
    addTokens(t) {
        this.tokens += t;
        this.tokens = Math.min(this.tokens, this.maxTokens);
    }
    setTokens(t) {
        this.tokens = t;
    }
    getTokens() {
        return this.tokens;
    }
    enqueue(task) {
        if (this.queuedIds.has(task.name)) {
            throw new Error(`A task has already been queued with id ${task.name}`);
        }
        const emulatedTask = {
            task: task,
            metadata: {
                currentAttempt: 0,
                currentBackoff: 0,
                startTime: 0,
                status: TaskStatus.NOT_STARTED,
                lastRunTime: null,
                previousResponse: null,
                executionCount: 0,
            },
        };
        emulatedTask.task.httpRequest.url =
            emulatedTask.task.httpRequest.url === ""
                ? this.config.defaultUri
                : emulatedTask.task.httpRequest.url;
        this.queue.enqueue(emulatedTask.task.name, emulatedTask);
        this.queuedIds.add(task.name);
        this.addedTimes.push(Date.now());
    }
    delete(taskId) {
        this.queue.remove(taskId);
    }
    getDebugInfo() {
        return `
    Task Queue (${this.key}): 
    - Active: ${this.isActive().toString()}
    - Tokens: ${this.tokens}
    - In Queue: ${this.queue.size()}
    - Dispatch: [
      ${this.dispatches.map((t) => (t === null ? "empty" : t.task.name)).join(",\n")}
    ]
    - Open Locations: [${this.openDispatches.join(", ")}]
    `;
    }
    getStatistics() {
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        const oneMinuteAgo = Date.now() - 60 * 1000;
        this.addedTimes = this.addedTimes.filter((t) => t > fiveMinutesAgo);
        this.failedTimes = this.failedTimes.filter((t) => t > fiveMinutesAgo);
        this.completedTimes = this.completedTimes.filter((t) => t > oneMinuteAgo);
        return {
            numberOfTasks: this.queue.size(),
            tasksAdded: this.addedTimes.length / 5,
            completedLastMin: this.completedTimes.length,
            failedTasks: this.failedTimes.length / 5,
            runningTasks: this.dispatches.length,
            maxRate: this.config.rateLimits.maxDispatchesPerSecond,
            maxConcurrent: this.config.rateLimits.maxConcurrentDispatches,
        };
    }
}
exports.TaskQueue = TaskQueue;
TaskQueue.TASK_QUEUE_INTERVAL = 1000;
