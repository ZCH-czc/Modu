import {
  Ionicons } from '@expo/vector-icons';
import { useEffect,
  useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Text } from "../i18n";
import { SafeAreaView } from 'react-native-safe-area-context';

import { BookCover } from '../components/BookCover';
import { Book } from '../types';

export function ShelfScreen({
  books,
  importing,
  onImport,
  onOpen,
}: {
  books: Book[];
  importing: boolean;
  onImport: () => void;
  onOpen: (book: Book) => void;
}) {
  const { width } = useWindowDimensions();
  const entrance = useRef(new Animated.Value(0)).current;
  const cardWidth = Math.min(118, Math.max(94, (width - 72) / 3));

  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: 420,
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Animated.View
        style={[
          styles.flex,
          {
            opacity: entrance,
            transform: [
              {
                translateY: entrance.interpolate({
                  inputRange: [0, 1],
                  outputRange: [16, 0],
                }),
              },
            ],
          },
        ]}
      >
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>YOUR QUIET LIBRARY</Text>
              <Text style={styles.heading}>我的书架</Text>
            </View>
            <Pressable
              onPress={onImport}
              disabled={importing}
              style={({ pressed }) => [styles.importButton, pressed && styles.pressed]}
            >
              {importing ? (
                <ActivityIndicator size="small" color="#FFF9EE" />
              ) : (
                <Ionicons name="add" size={22} color="#FFF9EE" />
              )}
            </Pressable>
          </View>

          <Pressable onPress={onImport} style={styles.importCard}>
            <View style={styles.importIcon}>
              <Ionicons name="document-attach-outline" size={22} color="#456657" />
            </View>
            <View style={styles.importText}>
              <Text style={styles.importTitle}>导入 EPUB 或 PDF</Text>
              <Text style={styles.importDescription}>
                文件会保存到应用本地书库，可离线打开
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#A0988E" />
          </Pressable>

          <View style={styles.sectionRow}>
            <View>
              <Text style={styles.sectionTitle}>藏书</Text>
              <Text style={styles.meta}>
                {books.length} 本 · {books.filter((book) => book.format !== 'sample').length} 本导入
              </Text>
            </View>
            <View style={styles.localPill}>
              <Ionicons name="phone-portrait-outline" size={13} color="#587365" />
              <Text style={styles.localText}>本地书库</Text>
            </View>
          </View>

          <View style={styles.grid}>
            {books.map((book, index) => (
              <AnimatedBook
                key={book.id}
                book={book}
                index={index}
                width={cardWidth}
                onPress={() => onOpen(book)}
              />
            ))}
          </View>
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

function AnimatedBook({
  book,
  width,
  index,
  onPress,
}: {
  book: Book;
  width: number;
  index: number;
  onPress: () => void;
}) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(value, {
      toValue: 1,
      duration: 330,
      delay: Math.min(index, 9) * 45,
      useNativeDriver: true,
    }).start();
  }, [index, value]);

  return (
    <Animated.View
      style={{
        width,
        opacity: value,
        transform: [
          {
            translateY: value.interpolate({
              inputRange: [0, 1],
              outputRange: [18, 0],
            }),
          },
        ],
      }}
    >
      <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.bookPressed}>
        <BookCover book={book} width={width} height={width * 1.42} />
        <Text style={styles.bookTitle} numberOfLines={1}>{book.title}</Text>
        <Text style={styles.bookAuthor} numberOfLines={1}>{book.author}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: '#F7F4ED' },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  eyebrow: {
    color: '#9A8D76',
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: '700',
  },
  heading: { color: '#292B27', fontSize: 30, lineHeight: 38, fontWeight: '900' },
  importButton: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#315D4B',
  },
  pressed: { opacity: 0.55, transform: [{ scale: 0.95 }] },
  importCard: {
    minHeight: 78,
    borderRadius: 20,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EEEAE1',
    borderWidth: 1,
    borderColor: '#E0DACF',
  },
  importIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DDE8DE',
  },
  importText: { flex: 1, marginLeft: 12 },
  importTitle: { color: '#35493F', fontSize: 14, fontWeight: '800' },
  importDescription: { color: '#948D83', fontSize: 10, marginTop: 4 },
  sectionRow: {
    marginTop: 28,
    marginBottom: 17,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  sectionTitle: { color: '#2B2D29', fontSize: 22, fontWeight: '900' },
  meta: { color: '#989187', fontSize: 11, marginTop: 3 },
  localPill: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E3EAE3',
  },
  localText: { color: '#587365', fontSize: 10, fontWeight: '700' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 25,
  },
  bookPressed: { opacity: 0.65, transform: [{ scale: 0.96 }] },
  bookTitle: { color: '#302F2B', fontSize: 13, fontWeight: '800', marginTop: 11 },
  bookAuthor: { color: '#938D84', fontSize: 10, marginTop: 3 },
});
