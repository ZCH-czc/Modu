import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';

import { Book, BookFormat } from '../types';

const LIBRARY_KEY = '@modu/imported-books/v2';
const MAX_IMPORT_SIZE = 25 * 1024 * 1024;
const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  textNodeName: '#text',
  trimValues: true,
});

export async function loadImportedBooks(): Promise<Book[]> {
  const raw = await AsyncStorage.getItem(LIBRARY_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Book[];
  } catch {
    return [];
  }
}

export async function importBook(): Promise<Book | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/epub+zip', 'application/pdf'],
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;

  const asset = result.assets[0];
  const format = inferFormat(asset.name, asset.mimeType);
  if (!format) throw new Error('目前只支持 EPUB 和 PDF。');
  if (asset.size && asset.size > MAX_IMPORT_SIZE) {
    throw new Error('请选择 25 MB 以内的文件。');
  }

  const id = `local-${Date.now()}`;
  const directory = getLibraryDirectory();
  const stored = new File(directory, `${id}.${format}`);
  new File(asset.uri).copy(stored);

  let book: Book = {
    id,
    title: asset.name.replace(/\.[^.]+$/, ''),
    author: '本地文档',
    category: '导入',
    progress: 0,
    currentChapter: format === 'epub' ? '开始阅读' : 'PDF 文档',
    lastRead: '刚刚',
    coverColors:
      format === 'epub'
        ? ['#314E43', '#67816F', '#D4BA87']
        : ['#6C3F3D', '#A66B61', '#E1C5AA'],
    accent: format === 'epub' ? '#D7BD85' : '#F0D0A8',
    darkCover: true,
    pages: [],
    format,
    fileUri: stored.uri,
    importedAt: Date.now(),
    sourceSize: asset.size,
  };

  if (format === 'epub') book = await parseEpub(stored, book);
  else validatePdf(stored);

  const current = await loadImportedBooks();
  await persist([book, ...current]);
  return book;
}

export async function hydrateBook(book: Book) {
  if (book.format !== 'epub' || book.pages.length || !book.contentUri) {
    return book;
  }
  const file = new File(book.contentUri);
  if (!file.exists) throw new Error('EPUB 正文缓存不存在，请重新导入。');
  const content = JSON.parse(await file.text()) as {
    pages: string[];
    pageTitles: string[];
  };
  return { ...book, ...content };
}

export async function deleteImportedBook(book: Book) {
  for (const uri of [book.fileUri, book.contentUri]) {
    if (!uri) continue;
    const file = new File(uri);
    if (file.exists) file.delete();
  }
  const next = (await loadImportedBooks()).filter((item) => item.id !== book.id);
  await persist(next);
  return next;
}

async function persist(books: Book[]) {
  const compact = books.map((book) => ({
    ...book,
    pages: book.format === 'epub' ? [] : book.pages,
    pageTitles: book.format === 'epub' ? [] : book.pageTitles,
  }));
  await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(compact));
}

async function parseEpub(file: File, base: Book): Promise<Book> {
  const zip = await JSZip.loadAsync(await file.bytes());
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) throw new Error('EPUB 容器结构无效。');
  const container = xml.parse(await containerFile.async('text'));
  const rootfile = first(container?.container?.rootfiles?.rootfile);
  const opfPath = rootfile?.['full-path'];
  if (typeof opfPath !== 'string') throw new Error('找不到 EPUB 描述文件。');
  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error('EPUB 描述文件缺失。');

  const pkg = xml.parse(await opfFile.async('text'))?.package;
  const manifestItems = array<Record<string, unknown>>(pkg?.manifest?.item);
  const spineItems = array<Record<string, unknown>>(pkg?.spine?.itemref);
  const manifest = new Map(manifestItems.map((item) => [String(item.id), item]));
  const baseDir = dirname(opfPath);
  const pages: string[] = [];
  const pageTitles: string[] = [];

  for (const ref of spineItems) {
    const item = manifest.get(String(ref.idref));
    if (!item?.href) continue;
    const entry = zip.file(resolvePath(baseDir, String(item.href)));
    if (!entry) continue;
    const html = await entry.async('text');
    const title = chapterTitle(html) || `第 ${new Set(pageTitles).size + 1} 节`;
    for (const page of paginate(toText(html))) {
      pages.push(page);
      pageTitles.push(title);
    }
  }
  if (!pages.length) throw new Error('没有解析到可阅读正文。');

  const content = new File(getLibraryDirectory(), `${base.id}.content.json`);
  content.create({ overwrite: true, intermediates: true });
  content.write(JSON.stringify({ pages, pageTitles }));

  return {
    ...base,
    title: textValue(pkg?.metadata?.title) || base.title,
    author: textValue(pkg?.metadata?.creator) || '未知作者',
    currentChapter: pageTitles[0],
    pages,
    pageTitles,
    contentUri: content.uri,
  };
}

function getLibraryDirectory() {
  const directory = new Directory(Paths.document, 'modu-library');
  if (!directory.exists) {
    directory.create({ idempotent: true, intermediates: true });
  }
  return directory;
}

function validatePdf(file: File) {
  const head = file.bytesSync().slice(0, 5);
  if (String.fromCharCode(...head) !== '%PDF-') {
    throw new Error('所选文件不是有效 PDF。');
  }
}

function inferFormat(
  name: string,
  mime?: string,
): Extract<BookFormat, 'epub' | 'pdf'> | null {
  const extension = name.split('.').pop()?.toLowerCase();
  if (extension === 'epub' || mime === 'application/epub+zip') return 'epub';
  if (extension === 'pdf' || mime === 'application/pdf') return 'pdf';
  return null;
}

function first<T>(value: T | T[]): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function array<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string {
  const item = first(value as unknown | unknown[]);
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object' && '#text' in item) {
    return String((item as { '#text': unknown })['#text']);
  }
  return '';
}

function dirname(path: string) {
  return path.split('/').slice(0, -1).join('/');
}

function resolvePath(base: string, relative: string) {
  const parts = `${base}/${decodeURIComponent(relative.split('#')[0])}`.split('/');
  const output: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') output.pop();
    else output.push(part);
  }
  return output.join('/');
}

function chapterTitle(html: string) {
  const match =
    html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i) ??
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? toText(match[1]).slice(0, 50) : '';
}

function toText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|section)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function paginate(text: string, target = 360) {
  const paragraphs = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const pages: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > target && current) {
      pages.push(current);
      current = paragraph;
    } else current = next;
  }
  if (current) pages.push(current);
  return pages;
}
