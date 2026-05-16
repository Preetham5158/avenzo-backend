import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <View><Text>Order {id}</Text></View>;
}
