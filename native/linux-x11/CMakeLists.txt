cmake_minimum_required(VERSION 3.16)

project(smart_zoom_helper LANGUAGES CXX)

find_package(PkgConfig REQUIRED)
pkg_check_modules(X11 REQUIRED IMPORTED_TARGET x11)
pkg_check_modules(XRANDR REQUIRED IMPORTED_TARGET xrandr)
pkg_check_modules(XINERAMA REQUIRED IMPORTED_TARGET xinerama)

add_executable(smart-zoom-helper smart_zoom_helper.cpp)
target_compile_features(smart-zoom-helper PRIVATE cxx_std_17)
target_link_libraries(
  smart-zoom-helper
  PRIVATE
    PkgConfig::X11
    PkgConfig::XRANDR
    PkgConfig::XINERAMA
)

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(
    smart-zoom-helper
    PRIVATE
      -Wall
      -Wextra
      -Wpedantic
      -Wconversion
      -Wsign-conversion
  )
endif()
