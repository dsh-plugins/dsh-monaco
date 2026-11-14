/**
 * 宿主注入给浏览器的配置全局名。
 *
 * 宿主与浏览器两端都要拼这个名字，所以单独放一个不含任何依赖的模块，
 * 避免客户端为了一个常量把宿主目录扯进构建。
 * @module dsh-monaco/shared/client-config
 */

/** `webserver/index-inject` 写入、`window` 上读取的配置全局名。 */
export const CLIENT_CONFIG_GLOBAL = '__DSH_MONACO_CONFIG__'
