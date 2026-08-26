cmake_minimum_required(VERSION 3.20)

project(smart_zoom_helper LANGUAGES CXX)

add_executable(smart-zoom-helper smart_zoom_helper.cpp)
target_compile_features(smart-zoom-helper PRIVATE cxx_std_17)
target_compile_definitions(
  smart-zoom-helper
  PRIVATE
    UNICODE
    _UNICODE
    WIN32_LEAN_AND_MEAN
    NOMINMAX
    _WIN32_WINNT=0x0A00
)
target_link_libraries(smart-zoom-helper PRIVATE user32)

if(MSVC)
  target_compile_options(smart-zoom-helper PRIVATE /W4 /permissive- /EHsc)
endif()
