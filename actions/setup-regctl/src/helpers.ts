import * as os from 'os'
import * as util from 'util'

export function getRegctlArch(): string {
   const arch = os.arch()
   if (arch === 'x64') {
      return 'amd64'
   }
   return arch
}

export function getregctlDownloadURL(version: string, arch: string): string {
   switch (os.type()) {
      case 'Linux':
         return `https://github.com/regclient/regclient/releases/download/${version}/regctl-linux-${arch}`

      case 'Darwin':
         return `https://github.com/regclient/regclient/releases/download/${version}/regctl-darwin-${arch}`

      case 'Windows_NT':
      default:
         return `https://github.com/regclient/regclient/releases/download/${version}/regctl-windows-${arch}.exe`
   }
}

export function getExecutableExtension(): string {
   if (os.type().match(/^Win/)) {
      return '.exe'
   }
   return ''
}
