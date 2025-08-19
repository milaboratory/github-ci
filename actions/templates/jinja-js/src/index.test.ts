import * as core from '@actions/core';
import { run } from './index'; // Assuming the run function is exported from index.ts

// Mock the GitHub Actions core library
jest.mock('@actions/core');

const mockedCore = core as jest.Mocked<typeof core>;

describe('Jinja-JS Template Renderer Action', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render a simple template correctly', () => {
    // Arrange: Set up the inputs
    const data = JSON.stringify({ name: 'World' });
    const template = 'Hello, {{ name }}!';
    mockedCore.getInput.mockImplementation((name: string) => {
      if (name === 'data') return data;
      if (name === 'template') return template;
      return '';
    });

    // Act: Run the action's main function
    run();

    // Assert: Check that the output was set correctly
    expect(mockedCore.setOutput).toHaveBeenCalledWith('result', 'Hello, World!');
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  it('should render a template with a custom json filter', () => {
    // Arrange
    const data = JSON.stringify({ user: { name: 'John', age: 30 } });
    const template = 'User Data: {{ user | json }}';
    mockedCore.getInput.mockImplementation((name: string) => {
      if (name === 'data') return data;
      if (name === 'template') return template;
      return '';
    });

    const expectedJson = JSON.stringify({ name: 'John', age: 30 }, null, 2);

    // Act
    run();

    // Assert
    expect(mockedCore.setOutput).toHaveBeenCalledWith('result', `User Data: ${expectedJson}`);
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  it('should fail if the data input is not valid JSON', () => {
    // Arrange
    const invalidData = 'not-json';
    const template = 'This should not render.';
    mockedCore.getInput.mockImplementation((name: string) => {
      if (name === 'data') return invalidData;
      if (name === 'template') return template;
      return '';
    });

    // Act
    run();

    // Assert
    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Unexpected token')
    );
    expect(mockedCore.setOutput).not.toHaveBeenCalled();
  });

  it('should fail if a variable is missing from the template', () => {
    // Arrange
    const data = JSON.stringify({ name: 'World' });
    // The template uses 'planet', but the data provides 'name'
    const template = 'Hello, {{ planet }}!'; 
    mockedCore.getInput.mockImplementation((name: string) => {
      if (name === 'data') return data;
      if (name === 'template') return template;
      return '';
    });

    // Act
    run();

    // Assert
    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('attempted to output null or undefined value')
    );
    expect(mockedCore.setOutput).not.toHaveBeenCalled();
  });
});
