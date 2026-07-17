import {
  LinearGradient } from 'expo-linear-gradient';
import { StyleSheet,
  View,
} from 'react-native';
import { Text } from "../i18n";

import { Book } from '../types';

export function BookCover({
  book,
  width,
  height,
}: {
  book: Book;
  width: number;
  height: number;
}) {
  const color = book.darkCover ? '#FFF9ED' : '#292824';
  return (
    <View style={[styles.shadow, { width, height }]}>
      <LinearGradient colors={book.coverColors} style={styles.cover}>
        <View style={[styles.rule, { backgroundColor: book.accent }]} />
        <View style={styles.center}>
          <Text
            style={[styles.title, { color, fontSize: Math.max(14, width * 0.16) }]}
            numberOfLines={3}
          >
            {book.title}
          </Text>
          <Text style={[styles.author, { color: `${color}B5` }]}>
            {book.author}
          </Text>
        </View>
        <Text style={[styles.format, { color: `${color}A0` }]}>
          {book.format === 'sample'
            ? '墨读'
            : book.format === 'webclip'
              ? '网页'
              : book.format.toUpperCase()}
        </Text>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progress,
              { width: `${book.progress * 100}%`, backgroundColor: book.accent },
            ]}
          />
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    borderRadius: 10,
    backgroundColor: '#D8D0C4',
    shadowColor: '#342D24',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 7,
  },
  cover: { flex: 1, borderRadius: 10, overflow: 'hidden', padding: 13 },
  rule: { width: 22, height: 3, borderRadius: 2 },
  center: { flex: 1, justifyContent: 'center' },
  title: { fontWeight: '800', lineHeight: 26, letterSpacing: 1 },
  author: { fontSize: 9, marginTop: 8 },
  format: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: '#FFFFFF44',
  },
  progress: { height: 3 },
});
