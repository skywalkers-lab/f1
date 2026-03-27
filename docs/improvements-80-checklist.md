# Shared Protocol Hardening Checklist (80+ 적용 항목)

아래 항목은 이번 패치에서 반영한 개선점이다.

## Command Protocol (35)
1. 프로토콜 버전 상수 고정.
2. 명령 타입 카탈로그 확장.
3. 우선순위 enum 고정.
4. source enum 도입.
5. 최소 TTL 상수 도입.
6. 최대 TTL 상수 도입.
7. 텍스트 최대 길이 상수 도입.
8. 태그 개수 상한 도입.
9. 태그 길이 상한 도입.
10. 객체 여부 유틸 추가.
11. 정수 clamp 유틸 추가.
12. 공백 정규화 텍스트 유틸 추가.
13. 알 수 없는 타입을 CUSTOM으로 강등.
14. source normalize 추가.
15. payload defensive clone.
16. tag 중복 제거.
17. tag 소문자 정규화.
18. tag 빈 값 제거.
19. 생성 시 stable id 자동 생성.
20. id 해시 기반 deterministic 포맷.
21. ttl clamp public helper 유지.
22. createdAt 범위 검증.
23. expiresAt 자동 계산.
24. priority 범위 강제.
25. roomId 길이 제한.
26. title 길이 제한.
27. body 길이 제한.
28. requireAck 플래그 표준화.
29. targetDriverIndex 지원.
30. targetDriverIndex 범위 검증.
31. meta 필드 지원.
32. 만료 판정 helper 제공.
33. 남은 TTL helper 제공.
34. 입력 객체 불일치 시 명시적 오류 반환.
35. protocolVersion 자동 주입.

## WS Protocol (22)
36. message type 카탈로그 확장.
37. telemetry health 전송 타입 추가.
38. command ack 타입 추가.
39. radio/event log 타입 추가.
40. 문자열 normalize 유틸 도입.
41. messageId 생성 로직 도입.
42. correlationId 지원.
43. role 길이 제한.
44. roomId 길이 제한.
45. type 길이 제한.
46. sentAtMs 강제 numeric 처리.
47. payload null 보호.
48. envelope validator 추가.
49. protocolVersion 유효성 검사.
50. sentAtMs 유효성 검사.
51. type required 검사.
52. envelope object 타입 검사.
53. 잘못된 payload fallback 처리.
54. normalize된 envelope 반환.
55. build/validate API 분리.
56. messageId 없을 때 자동 생성.
57. protocolVersion 기본값 공유.

## Frame Aggregator (28)
58. 다중 세션 집계 지원.
59. session key factory 주입 지원.
60. session counter 구조 분리.
61. frame map per-session 저장.
62. packet frequency 집계.
63. 기본 required packet set 유지.
64. required packet dedupe.
65. maxFrames 옵션 지원.
66. retainFrames 옵션 지원.
67. prune 정책 분리.
68. invalid packet 카운트 유지.
69. out-of-order 카운트 유지.
70. gap 누적 유지.
71. duplicate 누적 유지.
72. latest timestamp 추적.
73. first timestamp 추적.
74. latest frame id 추적.
75. frame-level envelope 보존.
76. coverage 계산 per-session.
77. aggregate coverage 평균화.
78. aggregate health 계산.
79. health 계산식 재조정.
80. coverage normalize 방어.
81. packet sample penalty 개선.
82. 상태 등급(excellent/good/degraded/critical).
83. 단일 세션 reset 지원.
84. 전체 reset 지원.
85. session snapshot 배열 반환.

## Tests/Verification (8)
86. TTL clamp/priority clamp 테스트 유지.
87. envelope shape 테스트 유지.
88. out-of-order 테스트 유지.
89. 다중 세션 집계 테스트 추가.
90. session-level reset 테스트 추가.
91. envelope validator 오류 테스트 추가.
92. envelope validator 성공 테스트 추가.
93. command expiry helper 테스트 추가.
