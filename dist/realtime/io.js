"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tryGetIO = exports.initIO = void 0;
let io = null;
const initIO = (instance) => (io = instance);
exports.initIO = initIO;
const tryGetIO = () => io;
exports.tryGetIO = tryGetIO;
