"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateName = exports.validatePassword = exports.validateEmail = void 0;
const validateEmail = (email) => {
    if (!email)
        return 'Email is required';
    if (email.length > 254)
        return 'Email is too long (max 254 characters)';
    if (!email.includes('@'))
        return 'Invalid email format';
    return null; // No error
};
exports.validateEmail = validateEmail;
const validatePassword = (password) => {
    if (!password)
        return 'Password is required';
    if (password.length < 8)
        return 'Password must be at least 8 characters';
    if (password.length > 128)
        return 'Password is too long (max 128 characters)';
    return null;
};
exports.validatePassword = validatePassword;
const validateName = (name) => {
    if (!name)
        return 'Name is required';
    if (name.length > 100)
        return 'Name is too long (max 100 characters)';
    return null;
};
exports.validateName = validateName;
