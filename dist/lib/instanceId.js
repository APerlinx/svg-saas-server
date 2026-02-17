"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.INSTANCE_ID = void 0;
const os_1 = __importDefault(require("os"));
exports.INSTANCE_ID = (_a = process.env.INSTANCE_ID) !== null && _a !== void 0 ? _a : `${os_1.default.hostname()}-${process.pid}`;
