'use strict';

const { start } = require('./lib/http');

start().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
