import * as core from '@actions/core';
import * as nunjucks from 'nunjucks';

function run(): void {
  try {
    const dataInput = core.getInput('data', { required: true });
    const template = core.getInput('template', { required: true });

    const data = JSON.parse(dataInput);

    const env = new nunjucks.Environment(null, {
      autoescape: false,
      throwOnUndefined: true,
      trimBlocks: true,
      lstripBlocks: true,
    });
    
    // Add a custom filter to convert objects to JSON strings
    env.addFilter('json', function (value) {
      return JSON.stringify(value, null, 2);
    });

    const result = env.renderString(template, data);

    core.setOutput('result', result);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unknown error occurred.');
    }
  }
}

run();
