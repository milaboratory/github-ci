import * as path from 'path'
import * as util from 'util'
import * as fs from 'fs'

import * as toolCache from '@actions/tool-cache'
import * as core from '@actions/core'

import {
   getregctlDownloadURL,
   getRegctlArch,
   getExecutableExtension
} from './helpers'

const regctlToolName = 'regctl'

export async function run() {
   let version = core.getInput('version', {required: true})
   const cachedPath = await downloadRegctl(version)

   core.addPath(path.dirname(cachedPath))
   core.debug(
      `Regctl tool version: '${version}' has been cached at ${cachedPath}`
   )
   core.setOutput('regctl-path', cachedPath)
}

export async function downloadRegctl(version: string): Promise<string> {
   let cachedToolpath = toolCache.find(regctlToolName, version)
   let regctlDownloadPath = ''
   const arch = getRegctlArch()
   if (!cachedToolpath) {
      try {
         regctlDownloadPath = await toolCache.downloadTool(
            getregctlDownloadURL(version, arch)
         )
      } catch (exception) {
         if (
            exception instanceof toolCache.HTTPError &&
            exception.httpStatusCode === 404
         ) {
            throw new Error(
               util.format(
                  "Regctl '%s' for '%s' arch not found.",
                  version,
                  arch
               )
            )
         } else {
            throw new Error('DownloadRegctlFailed')
         }
      }

      cachedToolpath = await toolCache.cacheFile(
         regctlDownloadPath,
         regctlToolName + getExecutableExtension(),
         regctlToolName,
         version
      )
   }

   const regctlPath = path.join(
      cachedToolpath,
      regctlToolName + getExecutableExtension()
   )
   fs.chmodSync(regctlPath, '775')
   return regctlPath
}

run().catch(core.setFailed)
