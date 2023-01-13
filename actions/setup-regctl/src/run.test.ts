import * as run from './run'
import {
   getregctlDownloadURL,
   getRegctlArch,
   getExecutableExtension
} from './helpers'
import * as os from 'os'
import * as toolCache from '@actions/tool-cache'
import * as fs from 'fs'
import * as path from 'path'
import * as core from '@actions/core'
import * as util from 'util'

describe('Testing all functions in run file.', () => {
   test('getExecutableExtension() - return .exe when os is Windows', () => {
      jest.spyOn(os, 'type').mockReturnValue('Windows_NT')

      expect(getExecutableExtension()).toBe('.exe')
      expect(os.type).toBeCalled()
   })

   test('getExecutableExtension() - return empty string for non-windows OS', () => {
      jest.spyOn(os, 'type').mockReturnValue('Darwin')

      expect(getExecutableExtension()).toBe('')
      expect(os.type).toBeCalled()
   })

   test.each([
      ['arm64', 'arm64'],
      ['x64', 'amd64']
   ])(
      'getRegctlArch() - return on %s os arch %s regctl arch',
      (osArch, regctlArch) => {
         jest.spyOn(os, 'arch').mockReturnValue(osArch)

         expect(getRegctlArch()).toBe(regctlArch)
         expect(os.arch).toBeCalled()
      }
   )

   test.each([['arm64'], ['amd64']])(
      'getregctlDownloadURL() - return the URL to download %s regctl for Linux',
      (arch) => {
         jest.spyOn(os, 'type').mockReturnValue('Linux')
         const regctlLinuxUrl = util.format(
            'https://github.com/regclient/regclient/releases/download/v0.4.5/regctl-linux-%s',
            arch
         )

         expect(getregctlDownloadURL('v0.4.5', arch)).toBe(regctlLinuxUrl)
         expect(os.type).toBeCalled()
      }
   )

   test.each([['arm64'], ['amd64']])(
      'getregctlDownloadURL() - return the URL to download %s regctl for Darwin',
      (arch) => {
         jest.spyOn(os, 'type').mockReturnValue('Darwin')
         const regctlDarwinUrl = util.format(
            'https://github.com/regclient/regclient/releases/download/v0.4.5/regctl-darwin-%s',
            arch
         )

         expect(getregctlDownloadURL('v0.4.5', arch)).toBe(regctlDarwinUrl)
         expect(os.type).toBeCalled()
      }
   )

   test.each([['arm64'], ['amd64']])(
      'getregctlDownloadURL() - return the URL to download %s regctl for Windows',
      (arch) => {
         jest.spyOn(os, 'type').mockReturnValue('Windows_NT')

         const regctlWindowsUrl = util.format(
            'https://github.com/regclient/regclient/releases/download/v0.4.5/regctl-windows-%s.exe'
            arch
         )
         expect(getregctlDownloadURL('v0.4.5', arch)).toBe(regctlWindowsUrl)
         expect(os.type).toBeCalled()
      }
   )

   test('downloadRegctl() - download regctl, add it to toolCache and return path to it', async () => {
      jest.spyOn(toolCache, 'find').mockReturnValue('')
      jest
         .spyOn(toolCache, 'downloadTool')
         .mockReturnValue(Promise.resolve('pathToTool'))
      jest
         .spyOn(toolCache, 'cacheFile')
         .mockReturnValue(Promise.resolve('pathToCachedTool'))
      jest.spyOn(os, 'type').mockReturnValue('Windows_NT')
      jest.spyOn(fs, 'chmodSync').mockImplementation(() => {})

      expect(await run.downloadRegctl('v0.4.5')).toBe(
         path.join('pathToCachedTool', 'regctl.exe')
      )
      expect(toolCache.find).toBeCalledWith('regctl', 'v0.4.5')
      expect(toolCache.downloadTool).toBeCalled()
      expect(toolCache.cacheFile).toBeCalled()
      expect(os.type).toBeCalled()
      expect(fs.chmodSync).toBeCalledWith(
         path.join('pathToCachedTool', 'regctl.exe'),
         '775'
      )
   })

   test('downloadRegctl() - throw DownloadRegctlFailed error when unable to download regctl', async () => {
      jest.spyOn(toolCache, 'find').mockReturnValue('')
      jest
         .spyOn(toolCache, 'downloadTool')
         .mockRejectedValue('Unable to download regctl.')

      await expect(run.downloadRegctl('v0.4.5')).rejects.toThrow(
         'DownloadRegctlFailed'
      )
      expect(toolCache.find).toBeCalledWith('regctl', 'v0.4.5')
      expect(toolCache.downloadTool).toBeCalled()
   })

   test('downloadRegctl() - throw regctl not found error when receive 404 response', async () => {
      const regctlVersion = 'v0.4.5'
      const arch = 'arm128'

      jest.spyOn(os, 'arch').mockReturnValue(arch)
      jest.spyOn(toolCache, 'find').mockReturnValue('')
      jest.spyOn(toolCache, 'downloadTool').mockImplementation((_) => {
         throw new toolCache.HTTPError(404)
      })

      await expect(run.downloadRegctl(regctlVersion)).rejects.toThrow(
         util.format(
            "Regctl '%s' for '%s' arch not found.",
            regctlVersion,
            arch
         )
      )
      expect(os.arch).toBeCalled()
      expect(toolCache.find).toBeCalledWith('regctl', regctlVersion)
      expect(toolCache.downloadTool).toBeCalled()
   })

   test('downloadRegctl() - return path to existing cache of regctl', async () => {
      jest.spyOn(toolCache, 'find').mockReturnValue('pathToCachedTool')
      jest.spyOn(os, 'type').mockReturnValue('Windows_NT')
      jest.spyOn(fs, 'chmodSync').mockImplementation(() => {})
      jest.spyOn(toolCache, 'downloadTool')

      expect(await run.downloadRegctl('v0.4.5')).toBe(
         path.join('pathToCachedTool', 'regctl.exe')
      )
      expect(toolCache.find).toBeCalledWith('regctl', 'v0.4.5')
      expect(os.type).toBeCalled()
      expect(fs.chmodSync).toBeCalledWith(
         path.join('pathToCachedTool', 'regctl.exe'),
         '775'
      )
      expect(toolCache.downloadTool).not.toBeCalled()
   })

   test('run() - download specified version and set output', async () => {
      jest.spyOn(core, 'getInput').mockReturnValue('v0.4.4')
      jest.spyOn(toolCache, 'find').mockReturnValue('pathToCachedTool')
      jest.spyOn(os, 'type').mockReturnValue('Windows_NT')
      jest.spyOn(fs, 'chmodSync').mockImplementation()
      jest.spyOn(core, 'addPath').mockImplementation()
      jest.spyOn(console, 'log').mockImplementation()
      jest.spyOn(core, 'setOutput').mockImplementation()

      expect(await run.run()).toBeUndefined()
      expect(core.getInput).toBeCalledWith('version', {required: true})
      expect(core.addPath).toBeCalledWith('pathToCachedTool')
      expect(core.setOutput).toBeCalledWith(
         'regctl-path',
         path.join('pathToCachedTool', 'regctl.exe')
      )
   })
})
