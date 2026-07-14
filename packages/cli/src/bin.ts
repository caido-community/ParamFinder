#!/usr/bin/env node
import { runCli } from "./cli";

const exitCode = await runCli();
process.exitCode = exitCode;
