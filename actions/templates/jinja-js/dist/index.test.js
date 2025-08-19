"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const index_1 = require("./index"); // Assuming the run function is exported from index.ts
// Mock the GitHub Actions core library
jest.mock('@actions/core');
const mockedCore = core;
describe('Jinja-JS Template Renderer Action', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it('should render a simple template correctly', () => {
        // Arrange: Set up the inputs
        const data = JSON.stringify({ name: 'World' });
        const template = 'Hello, {{ name }}!';
        mockedCore.getInput.mockImplementation((name) => {
            if (name === 'data')
                return data;
            if (name === 'template')
                return template;
            return '';
        });
        // Act: Run the action's main function
        (0, index_1.run)();
        // Assert: Check that the output was set correctly
        expect(mockedCore.setOutput).toHaveBeenCalledWith('result', 'Hello, World!');
        expect(mockedCore.setFailed).not.toHaveBeenCalled();
    });
    it('should render a template with a custom json filter', () => {
        // Arrange
        const data = JSON.stringify({ user: { name: 'John', age: 30 } });
        const template = 'User Data: {{ user | json }}';
        mockedCore.getInput.mockImplementation((name) => {
            if (name === 'data')
                return data;
            if (name === 'template')
                return template;
            return '';
        });
        const expectedJson = JSON.stringify({ name: 'John', age: 30 }, null, 2);
        // Act
        (0, index_1.run)();
        // Assert
        expect(mockedCore.setOutput).toHaveBeenCalledWith('result', `User Data: ${expectedJson}`);
        expect(mockedCore.setFailed).not.toHaveBeenCalled();
    });
    it('should fail if the data input is not valid JSON', () => {
        // Arrange
        const invalidData = 'not-json';
        const template = 'This should not render.';
        mockedCore.getInput.mockImplementation((name) => {
            if (name === 'data')
                return invalidData;
            if (name === 'template')
                return template;
            return '';
        });
        // Act
        (0, index_1.run)();
        // Assert
        expect(mockedCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('Unexpected token'));
        expect(mockedCore.setOutput).not.toHaveBeenCalled();
    });
    it('should fail if a variable is missing from the template', () => {
        // Arrange
        const data = JSON.stringify({ name: 'World' });
        // The template uses 'planet', but the data provides 'name'
        const template = 'Hello, {{ planet }}!';
        mockedCore.getInput.mockImplementation((name) => {
            if (name === 'data')
                return data;
            if (name === 'template')
                return template;
            return '';
        });
        // Act
        (0, index_1.run)();
        // Assert
        expect(mockedCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('attempted to output null or undefined value'));
        expect(mockedCore.setOutput).not.toHaveBeenCalled();
    });
});
